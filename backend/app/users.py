"""Manage accounts from the command line (run from the backend folder).

    python -m app.users list
    python -m app.users invite [--admin] [--hours 72] [--note "Dr. Aliyev"]
    python -m app.users create USERNAME [--admin]          (asks for the password)
    python -m app.users reset USERNAME                     (prints a reset link)
    python -m app.users disable USERNAME | enable USERNAME | delete USERNAME
    python -m app.users promote USERNAME | demote USERNAME

Links are printed with PUBLIC_URL (e.g. https://glioma.example.org) when it is
set, otherwise with http://localhost:8000.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from datetime import datetime

from .auth import AuthError, AuthStore
from .auth_routes import link_path
from .config import load_settings


def _store() -> tuple[AuthStore, str]:
    settings = load_settings()
    store = AuthStore(settings.data_dir / "auth.db", session_hours=settings.session_hours, idle_hours=settings.session_idle_hours)
    return store, settings.public_url or "http://localhost:8000"


def _when(stamp: float | None) -> str:
    return datetime.fromtimestamp(stamp).strftime("%Y-%m-%d %H:%M") if stamp else "never"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.users", description="Manage accounts.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="list accounts and open invite links")
    invite = commands.add_parser("invite", help="print a single-use sign-up link")
    invite.add_argument("--admin", action="store_true", help="the new account is an administrator")
    invite.add_argument("--hours", type=float, default=72.0, help="how long the link works (default 72)")
    invite.add_argument("--note", default="", help="who the link is for (shown to administrators)")
    create = commands.add_parser("create", help="create an account directly")
    create.add_argument("username")
    create.add_argument("--admin", action="store_true")
    create.add_argument("--name", default="", help="display name")
    for name in ("reset", "disable", "enable", "delete", "promote", "demote"):
        commands.add_parser(name).add_argument("username")
    args = parser.parse_args(argv)

    store, base = _store()
    try:
        if args.command == "list":
            accounts = store.list_users()
            if not accounts:
                print("No accounts yet. Run: python -m app.users invite --admin")
            for user in accounts:
                state = "disabled" if user.disabled else "active"
                print(f"{user.username:<24} {user.role:<7} {state:<9} last sign-in {_when(user.last_login_at)}")
            pending = store.pending_invites()
            if pending:
                print(f"\n{len(pending)} open link(s):")
                for item in pending:
                    print(f"  {item.id}  {item.kind:<6} {item.role:<7} until {_when(item.expires_at)}  {item.note}")
            return 0
        if args.command == "invite":
            token, item = store.create_invite(role="admin" if args.admin else "member", hours=args.hours, note=args.note)
            print(f"Single-use {'administrator' if args.admin else 'member'} sign-up link, valid until {_when(item.expires_at)}:\n")
            print(f"    {base}{link_path(token)}\n")
            print("Send it privately: anyone who has it can create the account.")
            return 0
        if args.command == "create":
            password = getpass.getpass("Password: ")
            if password != getpass.getpass("Repeat the password: "):
                print("The passwords do not match.", file=sys.stderr)
                return 1
            user = store.create_user(args.username, password, role="admin" if args.admin else "member", display_name=args.name)
            print(f"Created {user.username} ({user.role}).")
            return 0

        user = store.find_user(args.username)
        if user is None:
            print(f"No account named {args.username!r}.", file=sys.stderr)
            return 1
        if args.command == "reset":
            token, item = store.create_invite(kind="reset", role=user.role, user_id=user.id, note=f"reset for {user.username}", hours=24)
            print(f"Password reset link for {user.username}, valid until {_when(item.expires_at)}:\n\n    {base}{link_path(token)}\n")
        elif args.command in ("disable", "enable"):
            store.update_user(user.id, disabled=args.command == "disable")
            print(f"{user.username} is now {args.command}d.")
        elif args.command == "delete":
            store.delete_user(user.id)
            print(f"Deleted {user.username}.")
        elif args.command in ("promote", "demote"):
            store.update_user(user.id, role="admin" if args.command == "promote" else "member")
            print(f"{user.username} is now {'an administrator' if args.command == 'promote' else 'a member'}.")
        return 0
    except AuthError as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
