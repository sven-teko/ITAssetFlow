"""Bounded, per-process rate limits for one API worker."""
from __future__ import annotations

from collections import deque
from collections.abc import Callable
from hashlib import sha256
from ipaddress import IPv6Address, ip_address
from math import ceil
from threading import Lock
from time import monotonic

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class RequestWindow:
    def __init__(self, limit: int, seconds: int, *, clock: Callable[[], float] = monotonic,
                 max_keys: int = 4096):
        self.limit = limit
        self.seconds = seconds
        self.clock = clock
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}
        self._next_cleanup = 0.0
        self._lock = Lock()

    def consume(self, key: str) -> int:
        """Return 0 for admission or the number of seconds until a retry."""
        with self._lock:
            now = self.clock()
            cutoff = now - self.seconds
            if now >= self._next_cleanup:
                expired = [item for item, hits in self._hits.items() if hits[-1] <= cutoff]
                for item in expired:
                    del self._hits[item]
                self._next_cleanup = now + min(10, self.seconds)
            hits = self._hits.get(key)
            if hits is None:
                if len(self._hits) >= self.max_keys:
                    # Do not let fresh keys evict an existing limit.
                    return max(1, ceil(self._next_cleanup - now))
                hits = self._hits[key] = deque()
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self.limit:
                return max(1, ceil(hits[0] + self.seconds - now))
            hits.append(now)
            return 0


class RateLimits:
    def __init__(self, *, clock: Callable[[], float] = monotonic):
        self.api = RequestWindow(30, 10, clock=clock)
        self.login_ip = RequestWindow(5, 60, clock=clock)
        self.login_account = RequestWindow(10, 600, clock=clock)
        self.recovery_ip = RequestWindow(3, 600, clock=clock)
        self.recovery_account = RequestWindow(3, 600, clock=clock)


LOGIN_LIMIT_MESSAGE = "Zu viele Anmeldeversuche. Bitte warte und versuche es erneut."
RECOVERY_LIMIT_MESSAGE = "Zu viele Anfragen zum Zurücksetzen des Passworts. Bitte versuche es später erneut."
API_LIMIT_MESSAGE = "Zu viele Anfragen in kurzer Zeit. Bitte warte kurz und versuche es erneut."


def retry_headers(seconds: int) -> dict[str, str]:
    return {"Retry-After": str(seconds), "Cache-Control": "no-store"}


def account_key(email: str) -> str:
    return sha256(email.strip().casefold().encode()).hexdigest()


def client_key(scope: Scope, *, render: bool) -> str:
    if render:
        # Render's public ingress sets the first X-Forwarded-For address.
        forwarded = Headers(scope=scope).getlist("x-forwarded-for")
        host = forwarded[0].partition(",")[0].strip() if len(forwarded) == 1 else ""
    else:
        # Honour only the address already resolved by the ASGI server.
        client = scope.get("client")
        host = client[0] if client else ""
    try:
        address = ip_address(host)
    except ValueError:
        return "unknown"
    if isinstance(address, IPv6Address):
        if address.ipv4_mapped:
            return str(address.ipv4_mapped)
        return f"{IPv6Address(int(address) & ~((1 << 64) - 1))}/64"
    return str(address)


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp, *, limits: RateLimits, render: bool = False):
        self.app = app
        self.limits = limits
        self.render = render

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope["path"].rstrip("/")
        method = scope["method"]
        # Preflight, health checks and local logout do not touch the database.
        exempt = (method == "OPTIONS" or path == "/api/health" and method in ("GET", "HEAD")
                  or path == "/api/auth/logout" and method == "POST")
        if (path == "/api" or path.startswith("/api/")) and not exempt:
            ip = client_key(scope, render=self.render)
            retry = self.limits.api.consume(ip)
            detail = API_LIMIT_MESSAGE
            if not retry and method == "POST":
                if path == "/api/auth/login":
                    retry = self.limits.login_ip.consume(ip)
                    detail = LOGIN_LIMIT_MESSAGE
                elif path == "/api/auth/recovery/request":
                    retry = self.limits.recovery_ip.consume(ip)
                    detail = RECOVERY_LIMIT_MESSAGE
            if retry:
                response = JSONResponse({"detail": detail}, 429, headers=retry_headers(retry))
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
