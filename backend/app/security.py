"""HTTP hardening: security headers, request size limits and a cross-site request guard.

All three are plain ASGI middleware so they act before FastAPI reads a request
body: an oversized or cross-site upload is refused without being spooled to disk.
"""

from __future__ import annotations

import json
from typing import Callable
from urllib.parse import urlsplit

# The built frontend loads nothing from other origins. Inline styles are
# needed by React style props and by three.js helpers; scripts are never inline.
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "media-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

BASE_HEADERS = {
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
}

# Every state-changing API call from the web app carries this header. A page on
# another site cannot add it without a CORS preflight, which is refused.
CLIENT_HEADER = "x-glioma-client"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _header(scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key == name:
            return value.decode("latin-1")
    return None


def is_https(scope) -> bool:
    # uvicorn already applies X-Forwarded-Proto from trusted proxies to scope["scheme"].
    return scope.get("scheme") == "https" or (_header(scope, b"x-forwarded-proto") or "").split(",")[0].strip() == "https"


async def _send_json(send, status: int, detail: str, extra: dict[str, str] | None = None) -> None:
    body = json.dumps({"detail": detail}).encode("utf-8")
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    headers += [(k.encode(), v.encode()) for k, v in (extra or {}).items()]
    headers += [(k.encode(), v.encode()) for k, v in BASE_HEADERS.items()]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


class SecurityHeaders:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path: str = scope.get("path", "")
        https = is_https(scope)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in {b"server"}]
                present = {k.lower() for k, _ in headers}
                for key, value in BASE_HEADERS.items():
                    if key.encode() not in present:
                        headers.append((key.encode(), value.encode()))
                if https:
                    headers.append((b"strict-transport-security", b"max-age=31536000"))
                if b"cache-control" not in present:
                    if path.startswith("/assets/"):
                        cache = b"public, max-age=31536000, immutable"  # file names carry a content hash
                    elif path.startswith("/api/"):
                        cache = b"no-store"
                    else:
                        cache = b"no-cache"
                    headers.append((b"cache-control", cache))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BodyLimit:
    """Refuse request bodies over a per-route limit, whether or not Content-Length is sent."""

    def __init__(self, app, limit_for: Callable[[str, str], int]):
        self.app = app
        self.limit_for = limit_for

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in UNSAFE_METHODS:
            return await self.app(scope, receive, send)
        limit = self.limit_for(scope["method"], scope.get("path", ""))
        declared = _header(scope, b"content-length")
        if declared is not None:
            try:
                too_big = int(declared) > limit
            except ValueError:
                return await _send_json(send, 400, "Invalid Content-Length.")
            if too_big:
                return await _send_json(send, 413, _too_large(limit))

        received = 0
        exceeded = False
        started = False

        async def limited_receive():
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    return {"type": "http.disconnect"}
            return message

        async def tracking_send(message):
            nonlocal started
            if exceeded and not started:
                return  # replaced by the 413 below
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except Exception:
            if not exceeded:
                raise
        if exceeded and not started:
            await _send_json(send, 413, _too_large(limit))
        elif exceeded:
            pass  # the app answered already; the client sees the connection end


def _too_large(limit: int) -> str:
    if limit >= 1024**2:
        return f"The request is larger than the {limit // 1024**2} MB limit."
    return "The request is too large."


class CrossSiteGuard:
    """Unsafe API methods must come from this site: the client header, and a matching Origin when one is sent."""

    def __init__(self, app, allowed_origins: tuple[str, ...]):
        self.app = app
        self.allowed = {origin.rstrip("/").lower() for origin in allowed_origins}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in UNSAFE_METHODS or not scope.get("path", "").startswith("/api/"):
            return await self.app(scope, receive, send)
        if _header(scope, CLIENT_HEADER.encode()) is None:
            return await _send_json(send, 403, "Requests that change data must come from the web app.")
        origin = _header(scope, b"origin")
        if origin == "null":
            return await _send_json(send, 403, "Cross-site request refused.")
        if origin and origin.rstrip("/").lower() not in self.allowed:
            # Host names only: proxies often drop or change the port in Host.
            ours = {_hostname(_header(scope, b"host")), _hostname((_header(scope, b"x-forwarded-host") or "").split(",")[0])}
            if _hostname(origin, url=True) not in ours - {""}:
                return await _send_json(send, 403, "Cross-site request refused.")
        await self.app(scope, receive, send)


def _hostname(value: str | None, *, url: bool = False) -> str:
    if not value:
        return ""
    try:
        return (urlsplit(value.strip() if url else "//" + value.strip()).hostname or "").lower()
    except ValueError:
        return ""
