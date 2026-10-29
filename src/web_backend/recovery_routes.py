"""Passwort-Recovery mit einer separaten, kurzlebigen Auth-Sitzung."""
from __future__ import annotations

import os
import re
import time
from collections.abc import Callable, Sequence
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from httpx import TransportError
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from supabase import ClientOptions, create_client
from supabase_auth.errors import AuthRetryableError, AuthUnknownError

from config import get_app_config

RECOVERY_COOKIE = "itassetflow_recovery"
RECOVERY_PATH = "/api/auth/recovery"
INVALID_LINK = "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an."


class RecoveryEmail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)


class RecoveryToken(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access_token: SecretStr


class RecoveryPassword(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: SecretStr


def public_app_url() -> str:
    value = os.getenv("ITASSETFLOW_PUBLIC_URL") or os.getenv("RENDER_EXTERNAL_URL") or "https://itassetflow-demo.onrender.com"
    parsed = urlsplit(value.strip())
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise RuntimeError("ITASSETFLOW_PUBLIC_URL muss die HTTPS-Adresse der Anwendung enthalten.")
    return f"https://{parsed.netloc}/"


def recovery_client() -> Any:
    config = get_app_config()
    return create_client(config.supabase_url, config.supabase_key, options=ClientOptions(
        flow_type="implicit", auto_refresh_token=False, persist_session=False,
    ))


def reply(data: dict[str, Any], status: int = 200) -> JSONResponse:
    return JSONResponse(data, status_code=status, headers={
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    })


def clear_recovery(response: Response) -> None:
    response.delete_cookie(RECOVERY_COOKIE, path=RECOVERY_PATH, httponly=True, samesite="strict")


def access_failure(error: Exception) -> Response:
    if isinstance(error, (TransportError, AuthRetryableError, AuthUnknownError, RuntimeError)) or (getattr(error, "status", 0) or 0) >= 500:
        return reply({"detail": "Supabase ist vorübergehend nicht erreichbar. Bitte versuche es erneut."}, 503)
    response = reply({"detail": INVALID_LINK}, 401)
    clear_recovery(response)
    return response


def verify_access(token: str) -> tuple[Any, Any, Any]:
    if not token or len(token) > 8192:
        raise ValueError(INVALID_LINK)
    client = recovery_client()
    # set_session validates a current JWT through Supabase get_user. No refresh
    # token is retained: an expired recovery session requires a new email link.
    auth = client.auth.set_session(token, "")
    session, user = auth.session, auth.user
    if not session or not user or not user.id or not user.email or not session.expires_at or session.expires_at <= time.time():
        raise ValueError(INVALID_LINK)
    return client, user, session


def set_recovery(response: Response, request: Request, session: Any) -> None:
    response.set_cookie(
        RECOVERY_COOKIE, session.access_token,
        max_age=max(1, min(3600, int(session.expires_at - time.time()))),
        path=RECOVERY_PATH, httponly=True, samesite="strict",
        secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https",
    )


def create_recovery_router(clear_login: Callable[[Response], None], allowed_origins: Sequence[str]) -> APIRouter:
    router = APIRouter(prefix=RECOVERY_PATH, tags=["password-recovery"])

    def check_origin(request: Request) -> None:
        origin = request.headers.get("origin", "").rstrip("/")
        allowed = {value.rstrip("/") for value in allowed_origins}
        allowed.add(public_app_url().rstrip("/"))
        allowed.add(f"{request.url.scheme}://{request.url.netloc}")
        if not origin or origin not in allowed:
            raise HTTPException(403, "Die Anfrage stammt nicht von der Anwendung.")

    @router.post("/request")
    def request_link(payload: RecoveryEmail, request: Request) -> Response:
        check_origin(request)
        email = payload.email.strip()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            return reply({"detail": "Bitte eine gültige E-Mail-Adresse eingeben."}, 400)
        try:
            recovery_client().auth.reset_password_for_email(email, {"redirect_to": public_app_url()})
        except Exception as error:
            if getattr(error, "code", "") in {"over_email_send_rate_limit", "over_request_rate_limit"}:
                return reply({"detail": "Zu viele Anfragen. Bitte versuche es später erneut."}, 429)
            return reply({"detail": "Die E-Mail konnte nicht angefordert werden. Bitte versuche es später erneut."}, 503)
        return reply({"requested": True})

    @router.post("/session")
    def open_session(payload: RecoveryToken, request: Request) -> Response:
        check_origin(request)
        try:
            _, user, session = verify_access(payload.access_token.get_secret_value())
        except Exception as error:
            return access_failure(error)
        response = reply({"ready": True, "email": user.email})
        set_recovery(response, request, session)
        return response

    @router.get("/session")
    def session_status(request: Request) -> Response:
        try:
            _, user, _ = verify_access(request.cookies.get(RECOVERY_COOKIE, ""))
        except Exception as error:
            response = access_failure(error)
            if response.status_code == 401:
                response = reply({"ready": False})
                clear_recovery(response)
            return response
        return reply({"ready": True, "email": user.email})

    @router.delete("/session")
    def cancel_session(request: Request) -> Response:
        check_origin(request)
        response = reply({"cleared": True})
        clear_recovery(response)
        return response

    @router.post("/password")
    def change_password(payload: RecoveryPassword, request: Request) -> Response:
        check_origin(request)
        password = payload.password.get_secret_value()
        if len(password) < 8 or len(password) > 128:
            return reply({"detail": "Das neue Passwort muss 8 bis 128 Zeichen enthalten."}, 400)
        try:
            client, user, _ = verify_access(request.cookies.get(RECOVERY_COOKIE, ""))
        except Exception as error:
            return access_failure(error)
        try:
            updated = client.auth.update_user({"password": password})
            if not updated.user or updated.user.id != user.id:
                return reply({"detail": "Die Passwortänderung konnte nicht bestätigt werden."}, 502)
        except Exception as error:
            code = getattr(error, "code", "")
            if code == "same_password":
                return reply({"detail": "Bitte verwende ein anderes Passwort als bisher."}, 400)
            if code == "weak_password":
                return reply({"detail": "Das Passwort erfüllt die Passwortregeln nicht. Bitte wähle ein stärkeres Passwort."}, 400)
            if code in {"session_not_found", "session_expired", "bad_jwt", "reauthentication_needed"}:
                response = reply({"detail": INVALID_LINK}, 401)
                clear_recovery(response)
                return response
            return reply({"detail": "Das Passwort konnte nicht gespeichert werden. Bitte versuche es erneut."}, 503)
        try:
            client.auth.sign_out({"scope": "local"})
        except Exception:
            pass  # The password was already changed; do not report a false failure.
        response = reply({"updated": True})
        clear_recovery(response)
        clear_login(response)
        return response

    return router
