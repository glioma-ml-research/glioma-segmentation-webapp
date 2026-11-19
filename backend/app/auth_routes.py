"""/api/auth (sign in, invites, password) and /api/admin (team management)."""

from __future__ import annotations

import logging
import math
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .auth import SESSION_COOKIE, AuthError, AuthStore, RateLimiter, User
from .config import Settings
from .security import is_https

log = logging.getLogger(__name__)

WINDOW = 15 * 60.0
EXPIRED_LINK = "This link has expired or was already used. Ask your administrator for a new one."


# ------------------------------------------------------------- dependencies


def current_user(request: Request) -> User | None:
    return request.app.state.users.session_user(request.cookies.get(SESSION_COOKIE))


def require_user(user: User | None = Depends(current_user)) -> User:
    if user is None:
        raise HTTPException(401, "Please sign in.")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Only administrators can do this.")
    return user


def client_ip(request: Request) -> str:
    # uvicorn has already replaced this with X-Forwarded-For when the proxy is trusted.
    return request.client.host if request.client else "unknown"


def link_path(token: str) -> str:
    # The token rides in the fragment, so it never reaches server logs or Referer headers.
    return f"/signup#invite={token}"


# ------------------------------------------------------------------- bodies


class LoginBody(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


class RegisterBody(LoginBody):
    display_name: str = Field(default="", max_length=120)


class TokenBody(BaseModel):
    token: str = Field(max_length=128)


class SignupBody(BaseModel):
    token: str = Field(max_length=128)
    username: str = Field(default="", max_length=64)
    display_name: str = Field(default="", max_length=120)
    password: str = Field(max_length=256)


class PasswordBody(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class ProfileBody(BaseModel):
    display_name: str = Field(max_length=120)


class InviteBody(BaseModel):
    role: Literal["admin", "member"] = "member"
    note: str = Field(default="", max_length=120)
    hours: float = Field(default=72.0, ge=0.25, le=720)


class UserPatch(BaseModel):
    role: Literal["admin", "member"] | None = None
    disabled: bool | None = None
    display_name: str | None = Field(default=None, max_length=120)


# ------------------------------------------------------------------- router


def build_auth_routers(settings: Settings, users: AuthStore, limiter: RateLimiter, job_counts) -> tuple[APIRouter, APIRouter]:
    auth = APIRouter(prefix="/api/auth")
    admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

    def set_session(response: Response, request: Request, user: User) -> None:
        users.end_session(request.cookies.get(SESSION_COOKIE))  # never keep a pre-login session id
        token = users.create_session(user.id)
        secure = settings.cookie_secure == "always" or (settings.cookie_secure == "auto" and is_https(request.scope))
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=int(settings.session_hours * 3600),
            httponly=True,
            secure=secure,
            samesite="strict",
            path="/",
        )

    def throttle(*keys: tuple[str, int]) -> None:
        wait = max(limiter.retry_after(key, limit, WINDOW) for key, limit in keys)
        if wait:
            minutes = max(1, math.ceil(wait / 60))
            raise HTTPException(
                429,
                f"Too many attempts. Wait {minutes} minute{'s' if minutes != 1 else ''} and try again.",
                headers={"Retry-After": str(int(wait))},
            )

    # --------------------------------------------------------------- session

    @auth.get("/me")
    def me(user: User | None = Depends(current_user)):
        return {
            "user": user.public() if user else None,
            "setup_required": users.count_active_admins() == 0,
            "public_samples": settings.public_samples,
        }

    @auth.post("/login")
    def login(body: LoginBody, request: Request, response: Response):
        ip = client_ip(request)
        name = body.username.strip().lower()[:64]
        keys = ((f"pair:{name}|{ip}", 5), (f"user:{name}", 20), (f"ip:{ip}", 40))
        throttle(*keys)
        user = users.authenticate(name, body.password)
        if user is None:
            for key, _ in keys:
                limiter.hit(key)
            log.warning("failed sign-in for %r from %s", name, ip)
            raise HTTPException(401, "Wrong username or password.")
        limiter.clear(keys[0][0])
        set_session(response, request, user)
        log.info("signed in: %s", user.username)
        return {"user": user.public()}

    @auth.post("/logout", status_code=204)
    def logout(request: Request, response: Response):
        users.end_session(request.cookies.get(SESSION_COOKIE))
        response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="strict")
        response.status_code = 204
        return response

    # --------------------------------------------------------------- invites

    @auth.post("/invite")
    def check_invite(body: TokenBody, request: Request):
        """What a link is for, without using it up."""
        ip = client_ip(request)
        throttle((f"invite:{ip}", 30))
        invite = users.peek_invite(body.token)
        if invite is None:
            limiter.hit(f"invite:{ip}")
            raise HTTPException(404, EXPIRED_LINK)
        account = users.get_user(invite.user_id) if invite.user_id else None
        return {
            "kind": invite.kind,
            "role": invite.role,
            "expires_at": invite.expires_at,
            "username": account.username if account else None,
            "first_admin": users.count_active_admins() == 0,
        }

    @auth.post("/register", status_code=201)
    def register(body: RegisterBody, request: Request, response: Response):
        # Public registration always creates a member, including the first user.
        # Admin bootstrap remains a separate, server-console invitation.
        key = f"register:{client_ip(request)}"
        throttle((key, 5), ("register:global", 50))
        limiter.hit(key)
        limiter.hit("register:global")
        try:
            user = users.create_user(body.username, body.password, role="member", display_name=body.display_name)
        except AuthError as error:
            raise HTTPException(400, str(error))
        set_session(response, request, user)
        return {"user": user.public()}

    @auth.post("/signup")
    def signup(body: SignupBody, request: Request, response: Response):
        ip = client_ip(request)
        throttle((f"invite:{ip}", 30))
        if users.peek_invite(body.token) is None:
            limiter.hit(f"invite:{ip}")
            raise HTTPException(400, EXPIRED_LINK)
        try:
            user = users.redeem_invite(body.token, username=body.username, password=body.password, display_name=body.display_name)
        except AuthError as error:
            raise HTTPException(400, str(error))
        users.revoke_setup_invites()
        set_session(response, request, user)
        return {"user": user.public()}

    # --------------------------------------------------------------- account

    @auth.post("/password")
    def change_password(body: PasswordBody, request: Request, response: Response, user: User = Depends(require_user)):
        key = (f"password:{user.id}", 5)
        throttle(key)
        if not users.check_password(user.id, body.current_password):
            limiter.hit(key[0])
            raise HTTPException(400, "The current password is not right.")
        try:
            users.set_password(user.id, body.new_password)  # signs out every other device
        except AuthError as error:
            raise HTTPException(400, str(error))
        set_session(response, request, user)
        return {"user": user.public()}

    @auth.patch("/profile")
    def update_profile(body: ProfileBody, user: User = Depends(require_user)):
        return {"user": users.update_user(user.id, display_name=body.display_name).public()}

    # ----------------------------------------------------------------- admin

    def user_or_404(user_id: str) -> User:
        found = users.get_user(user_id)
        if found is None:
            raise HTTPException(404, "No such account.")
        return found

    @admin.get("/users")
    def list_users():
        counts = job_counts()
        return [{**user.public(), "jobs": counts.get(user.id, 0)} for user in users.list_users()]

    @admin.patch("/users/{user_id}")
    def update_user(user_id: str, body: UserPatch, me: User = Depends(require_user)):
        target = user_or_404(user_id)
        if target.id == me.id and (body.disabled or (body.role and body.role != "admin")):
            raise HTTPException(400, "You cannot disable or demote your own account.")
        try:
            return users.update_user(user_id, role=body.role, disabled=body.disabled, display_name=body.display_name).public()
        except AuthError as error:
            raise HTTPException(400, str(error))

    @admin.delete("/users/{user_id}", status_code=204)
    def delete_user(user_id: str, me: User = Depends(require_user)):
        target = user_or_404(user_id)
        if target.id == me.id:
            raise HTTPException(400, "You cannot delete your own account.")
        try:
            users.delete_user(user_id)
        except AuthError as error:
            raise HTTPException(400, str(error))
        return Response(status_code=204)

    @admin.post("/users/{user_id}/reset-link", status_code=201)
    def reset_link(user_id: str, me: User = Depends(require_user)):
        target = user_or_404(user_id)
        token, invite = users.create_invite(kind="reset", role=target.role, user_id=target.id, created_by=me.id, note=f"reset for {target.username}", hours=24)
        return {"invite": invite.public(), "path": link_path(token)}

    @admin.get("/invites")
    def list_invites():
        return [invite.public() for invite in users.pending_invites()]

    @admin.post("/invites", status_code=201)
    def create_invite(body: InviteBody, me: User = Depends(require_user)):
        try:
            token, invite = users.create_invite(role=body.role, note=body.note, hours=body.hours, created_by=me.id)
        except AuthError as error:
            raise HTTPException(400, str(error))
        return {"invite": invite.public(), "path": link_path(token)}

    @admin.delete("/invites/{invite_id}", status_code=204)
    def revoke_invite(invite_id: str):
        users.revoke_invite(invite_id)
        return Response(status_code=204)

    return auth, admin
