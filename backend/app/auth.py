"""Accounts, sessions and invite links. Standard library only (sqlite3, hashlib.scrypt).

Design
------
* Invite-only: nobody can sign up without a link made by an administrator.
  The very first administrator is created from a one-time setup link that is
  printed to the server console (or with ``python -m app.users``).
* Passwords: scrypt with the OWASP parameters (N=2^17, r=8, p=1, 16-byte salt).
  The parameters are stored with each hash, so they can be raised later; a
  login with weaker stored parameters re-hashes the password.
* Sessions: a random 256-bit token in an HttpOnly, SameSite=Strict cookie.
  The database stores only its SHA-256, so a copy of the database cannot be
  used to log in. Sessions end after an idle period and an absolute lifetime.
* Invite and reset links work the same way: random token, stored hashed,
  single use, expiring.
* Failed logins are rate-limited per account and per client address.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

SESSION_COOKIE = "glioma_session"
ROLES = ("admin", "member")
USERNAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$")
PASSWORD_MIN, PASSWORD_MAX = 10, 200
DISPLAY_NAME_MAX = 60

# A short deny-list of the passwords people try first. Length does most of the work.
COMMON_PASSWORDS = {
    "1234567890", "12345678910", "123456789012", "0123456789", "1111111111", "0000000000",
    "password12", "password123", "password1234", "passw0rd123", "qwertyuiop", "qwerty1234",
    "qwerty12345", "iloveyou12", "letmein123", "welcome123", "admin12345", "administrator",
    "abcdefghij", "abc1234567", "glioma1234", "glioma12345", "segmentation", "1q2w3e4r5t",
    "zaq12wsxcde", "asdfghjkl1", "football123", "baseball123", "princess123", "sunshine123",
}


class AuthError(ValueError):
    """A problem the user can fix (shown as is)."""


def _now() -> float:
    return time.time()


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ passwords


def _scrypt_cost() -> int:
    # Tests lower the cost through the environment; production keeps the OWASP value.
    return int(os.environ.get("GLIOMA_SCRYPT_N", str(2**17)))


def hash_password(password: str, *, n: int | None = None, r: int = 8, p: int = 1) -> str:
    n = n or _scrypt_cost()
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(_normalise(password).encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=256 * 1024**2, dklen=32)
    encode = lambda raw: base64.b64encode(raw).decode("ascii")  # noqa: E731
    return f"scrypt${n}${r}${p}${encode(salt)}${encode(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            _normalise(password).encode("utf-8"),
            salt=base64.b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=256 * 1024**2,
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def needs_rehash(stored: str) -> bool:
    try:
        _, n, *_ = stored.split("$")
        return int(n) < _scrypt_cost()
    except ValueError:
        return True


def _normalise(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def check_password_rules(password: str, username: str = "") -> None:
    password = _normalise(password)
    if len(password) < PASSWORD_MIN:
        raise AuthError(f"Use at least {PASSWORD_MIN} characters for the password.")
    if len(password) > PASSWORD_MAX:
        raise AuthError(f"Use at most {PASSWORD_MAX} characters for the password.")
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or len(set(lowered)) < 4:
        raise AuthError("This password is too easy to guess. Try a short sentence or a few unrelated words.")
    if username and len(username) >= 3 and username.lower() in lowered:
        raise AuthError("The password must not contain the username.")


def clean_username(raw: str) -> str:
    username = _normalise(raw or "").strip().lower()
    if not USERNAME_PATTERN.match(username) or ".." in username:
        raise AuthError("Usernames are 3–32 characters: lowercase letters, digits, dots, dashes or underscores.")
    return username


def clean_display_name(raw: str, fallback: str) -> str:
    name = "".join(ch for ch in _normalise(raw or "") if unicodedata.category(ch)[0] != "C").strip()
    name = re.sub(r"\s+", " ", name)
    return (name or fallback)[:DISPLAY_NAME_MAX]


# Hash checked when the username does not exist, so a miss costs as long as a hit.
_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None or needs_rehash(_DUMMY_HASH):
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    return _DUMMY_HASH


# ---------------------------------------------------------------- rate limits


class RateLimiter:
    """Sliding-window counters of failures, in memory (one server process)."""

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def retry_after(self, key: str, limit: int, window: float) -> float:
        """Seconds until ``key`` may try again (0 = allowed)."""
        with self._lock:
            events = self._events.get(key)
            if not events:
                return 0.0
            cutoff = _now() - window
            while events and events[0] < cutoff:
                events.popleft()
            if len(events) < limit:
                return 0.0
            return max(1.0, events[0] + window - _now())

    def hit(self, key: str) -> None:
        with self._lock:
            self._events[key].append(_now())
            if len(self._events) > 50_000:  # bound memory under a spray of keys
                for stale in [k for k, v in self._events.items() if not v or v[-1] < _now() - 3600][:25_000]:
                    self._events.pop(stale, None)

    def clear(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)


# -------------------------------------------------------------------- records


@dataclass(frozen=True)
class User:
    id: str
    username: str
    display_name: str
    role: str
    disabled: bool
    created_at: float
    last_login_at: float | None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def public(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "disabled": self.disabled,
            "created_at": self.created_at,
            "last_login_at": self.last_login_at,
        }


@dataclass(frozen=True)
class Invite:
    id: str
    kind: str  # "signup" | "reset"
    role: str
    note: str
    user_id: str | None  # the account a reset link is for
    created_by: str | None
    created_at: float
    expires_at: float
    used_at: float | None

    def public(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "role": self.role,
            "note": self.note,
            "user_id": self.user_id,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
        }


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    last_login_at REAL,
    password_changed_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    last_seen_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS invites (
    token_hash TEXT PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('signup', 'reset')),
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    note TEXT NOT NULL DEFAULT '',
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    used_at REAL
);
"""


def _user(row: sqlite3.Row) -> User:
    return User(
        id=row["id"],
        username=row["username"],
        display_name=row["display_name"],
        role=row["role"],
        disabled=bool(row["disabled"]),
        created_at=row["created_at"],
        last_login_at=row["last_login_at"],
    )


def _invite(row: sqlite3.Row) -> Invite:
    return Invite(
        id=row["id"],
        kind=row["kind"],
        role=row["role"],
        note=row["note"],
        user_id=row["user_id"],
        created_by=row["created_by"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
        used_at=row["used_at"],
    )


class AuthStore:
    """All account state. Thread-safe: one short-lived connection per call."""

    def __init__(self, path: Path, *, session_hours: float = 168.0, idle_hours: float = 48.0):
        self.path = path
        self.session_seconds = session_hours * 3600.0
        self.idle_seconds = idle_hours * 3600.0
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript(SCHEMA)
        try:
            os.chmod(path, 0o600)  # owner only (no effect on Windows)
        except OSError:
            pass

    def _connect(self) -> "_Closing":
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA journal_mode = WAL")
        return _Closing(db)

    # ------------------------------------------------------------- users

    def count_users(self) -> int:
        with self._connect() as db:
            return int(db.execute("SELECT COUNT(*) FROM users").fetchone()[0])

    def count_active_admins(self) -> int:
        with self._connect() as db:
            return int(db.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0").fetchone()[0])

    def get_user(self, user_id: str) -> User | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user(row) if row else None

    def find_user(self, username: str) -> User | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM users WHERE username = ?", (_normalise(username).strip().lower(),)).fetchone()
        return _user(row) if row else None

    def list_users(self) -> list[User]:
        with self._connect() as db:
            return [_user(row) for row in db.execute("SELECT * FROM users ORDER BY created_at")]

    def create_user(self, username: str, password: str, *, role: str = "member", display_name: str = "") -> User:
        username = clean_username(username)
        if role not in ROLES:
            raise AuthError("Unknown role.")
        check_password_rules(password, username)
        now = _now()
        user_id = uuid.uuid4().hex
        try:
            with self._connect() as db:
                db.execute(
                    "INSERT INTO users (id, username, display_name, password_hash, role, created_at, password_changed_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (user_id, username, clean_display_name(display_name, username), hash_password(password), role, now, now),
                )
        except sqlite3.IntegrityError as error:
            raise AuthError("That username is taken. Choose another one.") from error
        log.info("account created: %s (%s)", username, role)
        return self.get_user(user_id)  # type: ignore[return-value]

    def update_user(self, user_id: str, *, role: str | None = None, disabled: bool | None = None, display_name: str | None = None) -> User:
        user = self.get_user(user_id)
        if user is None:
            raise KeyError(user_id)
        if role is not None and role not in ROLES:
            raise AuthError("Unknown role.")
        losing_admin = user.is_admin and not user.disabled and ((role is not None and role != "admin") or disabled is True)
        if losing_admin and self.count_active_admins() <= 1:
            raise AuthError("This is the last active administrator. Make someone else an administrator first.")
        with self._connect() as db:
            if role is not None:
                db.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
            if disabled is not None:
                db.execute("UPDATE users SET disabled = ? WHERE id = ?", (int(disabled), user_id))
                if disabled:
                    db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            if display_name is not None:
                db.execute("UPDATE users SET display_name = ? WHERE id = ?", (clean_display_name(display_name, user.username), user_id))
        return self.get_user(user_id)  # type: ignore[return-value]

    def delete_user(self, user_id: str) -> None:
        user = self.get_user(user_id)
        if user is None:
            raise KeyError(user_id)
        if user.is_admin and not user.disabled and self.count_active_admins() <= 1:
            raise AuthError("This is the last active administrator and cannot be deleted.")
        with self._connect() as db:
            db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        log.info("account deleted: %s", user.username)

    def set_password(self, user_id: str, password: str) -> None:
        user = self.get_user(user_id)
        if user is None:
            raise KeyError(user_id)
        check_password_rules(password, user.username)
        with self._connect() as db:
            db.execute(
                "UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?",
                (hash_password(password), _now(), user_id),
            )
            # A new password signs out every device.
            db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    def authenticate(self, username: str, password: str) -> User | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM users WHERE username = ?", (_normalise(username or "").strip().lower(),)).fetchone()
        if row is None:
            verify_password(password, _dummy_hash())
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        user = _user(row)
        if user.disabled:
            return None
        with self._connect() as db:
            db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (_now(), user.id))
            if needs_rehash(row["password_hash"]):
                db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), user.id))
        return user

    def check_password(self, user_id: str, password: str) -> bool:
        with self._connect() as db:
            row = db.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        return bool(row) and verify_password(password, row["password_hash"])

    # ---------------------------------------------------------- sessions

    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = _now()
        with self._connect() as db:
            db.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                (_sha256(token), user_id, now, now, now + self.session_seconds),
            )
            db.execute("DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?", (now, now - self.idle_seconds))
            db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now, user_id))  # sign-in, sign-up or new password
        return token

    def session_user(self, token: str | None) -> User | None:
        if not token or len(token) > 128:
            return None
        now = _now()
        with self._connect() as db:
            row = db.execute(
                "SELECT s.last_seen_at, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
                (_sha256(token),),
            ).fetchone()
            if row is None:
                return None
            if row["expires_at"] < now or row["last_seen_at"] < now - self.idle_seconds or row["disabled"]:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha256(token),))
                return None
            if now - row["last_seen_at"] > 60:
                db.execute("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (now, _sha256(token)))
        return _user(row)

    def end_session(self, token: str | None) -> None:
        if token:
            with self._connect() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha256(token),))

    def end_all_sessions(self, user_id: str) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    # ----------------------------------------------------------- invites

    def create_invite(
        self,
        *,
        role: str = "member",
        kind: str = "signup",
        user_id: str | None = None,
        created_by: str | None = None,
        note: str = "",
        hours: float = 72.0,
    ) -> tuple[str, Invite]:
        """A new single-use link token. The token itself is returned once and never stored."""
        if role not in ROLES:
            raise AuthError("Unknown role.")
        if not 0.25 <= hours <= 24 * 30:
            raise AuthError("Links can last from 15 minutes to 30 days.")
        token = secrets.token_urlsafe(32)
        invite_id = uuid.uuid4().hex[:12]
        now = _now()
        note = clean_display_name(note, "")[:80]
        with self._connect() as db:
            db.execute(
                "INSERT INTO invites (token_hash, id, kind, role, note, user_id, created_by, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (_sha256(token), invite_id, kind, role, note, user_id, created_by, now, now + hours * 3600.0),
            )
        return token, self.get_invite_by_id(invite_id)  # type: ignore[return-value]

    def get_invite_by_id(self, invite_id: str) -> Invite | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()
        return _invite(row) if row else None

    def peek_invite(self, token: str | None) -> Invite | None:
        """The invite behind a token if it can still be used."""
        if not token or len(token) > 128:
            return None
        with self._connect() as db:
            row = db.execute("SELECT * FROM invites WHERE token_hash = ?", (_sha256(token),)).fetchone()
        if row is None or row["used_at"] is not None or row["expires_at"] < _now():
            return None
        return _invite(row)

    def pending_invites(self) -> list[Invite]:
        with self._connect() as db:
            db.execute("DELETE FROM invites WHERE expires_at < ? OR used_at IS NOT NULL", (_now() - 7 * 86400,))
            rows = db.execute("SELECT * FROM invites WHERE used_at IS NULL AND expires_at >= ? ORDER BY created_at DESC", (_now(),))
            return [_invite(row) for row in rows]

    def revoke_invite(self, invite_id: str) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM invites WHERE id = ?", (invite_id,))

    def revoke_setup_invites(self) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM invites WHERE created_by IS NULL AND kind = 'signup' AND used_at IS NULL AND note = 'first administrator'")

    def redeem_invite(self, token: str, *, username: str = "", password: str, display_name: str = "") -> User:
        """Use a signup link (creates the account) or a reset link (sets the password). Single use."""
        invite = self.peek_invite(token)
        if invite is None:
            raise AuthError("This link has expired or was already used. Ask your administrator for a new one.")
        if invite.kind == "reset":
            if not invite.user_id or self.get_user(invite.user_id) is None:
                raise AuthError("This link has expired or was already used. Ask your administrator for a new one.")
            self.set_password(invite.user_id, password)
            user = self.get_user(invite.user_id)
        else:
            user = self.create_user(username, password, role=invite.role, display_name=display_name)
        with self._connect() as db:
            claimed = db.execute(
                "UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL", (_now(), _sha256(token))
            ).rowcount
        if not claimed:  # raced with another use of the same link
            if invite.kind == "signup":
                self.delete_user(user.id)  # type: ignore[union-attr]
            raise AuthError("This link has expired or was already used. Ask your administrator for a new one.")
        return user  # type: ignore[return-value]


class _Closing:
    """sqlite3 connections do not close on ``with``; this one does."""

    def __init__(self, db: sqlite3.Connection):
        self._db = db

    def __enter__(self) -> sqlite3.Connection:
        return self._db

    def __exit__(self, *exc) -> None:
        self._db.close()
