from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Request,
    Response,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import Client

from config import get_app_config
from infrastructure.asset_repository import AssetRepository
from infrastructure.supabase_client import (
    authenticate_user,
    get_session_tokens,
    restore_user_session,
)
from inventory import (
    CONDITION_LABELS,
    DEFAULT_VISIBLE_COLUMNS,
    HEADER_LABELS,
    INVENTORY_GROUP_LABELS,
    PREFERRED_COLUMN_ORDER,
    STATUS_LABELS,
    get_category_key,
    get_condition_key,
    get_inventory_group,
    normalize_specifications,
)


app = FastAPI(
    title="ITAssetFlow API",
    version="1.0.0",
)


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# Auth-Cookies
# =========================================================

ACCESS_COOKIE = "itassetflow_access_token"
REFRESH_COOKIE = "itassetflow_refresh_token"

COOKIE_SECURE = (
    os.getenv(
        "ITASSETFLOW_COOKIE_SECURE",
        "false",
    )
    .strip()
    .casefold()
    in {
        "1",
        "true",
        "yes",
        "on",
    }
)


# =========================================================
# Modelle
# =========================================================

class LoginPayload(BaseModel):
    email: str
    password: str


@dataclass
class WebSession:
    client: Client
    email: str


# =========================================================
# Cookie-Helfer
# =========================================================

def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
) -> None:
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=60 * 60,
        path="/",
    )

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
        path="/",
    )


def clear_auth_cookies(
    response: Response,
) -> None:
    response.delete_cookie(
        ACCESS_COOKIE,
        path="/",
    )

    response.delete_cookie(
        REFRESH_COOKIE,
        path="/",
    )


# =========================================================
# Web-Sitzung
# =========================================================

def get_web_session(
    request: Request,
    response: Response,
) -> WebSession:
    access_token = str(
        request.cookies.get(
            ACCESS_COOKIE
        )
        or ""
    ).strip()

    refresh_token = str(
        request.cookies.get(
            REFRESH_COOKIE
        )
        or ""
    ).strip()

    if not access_token or not refresh_token:
        raise HTTPException(
            status_code=401,
            detail="Nicht angemeldet.",
        )

    config = get_app_config()

    try:
        client, email = restore_user_session(
            config.supabase_url,
            config.supabase_key,
            access_token,
            refresh_token,
        )

    except Exception as error:
        clear_auth_cookies(
            response
        )

        raise HTTPException(
            status_code=401,
            detail=str(error),
        ) from error

    tokens = get_session_tokens(
        client
    )

    if tokens is not None:
        new_access_token = tokens[0]
        new_refresh_token = tokens[1]

        if (
            new_access_token != access_token
            or new_refresh_token != refresh_token
        ):
            set_auth_cookies(
                response,
                new_access_token,
                new_refresh_token,
            )

    return WebSession(
        client=client,
        email=email,
    )


# =========================================================
# Allgemein
# =========================================================

@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "ITAssetFlow Web API läuft.",
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "application": "ITAssetFlow",
    }


# =========================================================
# Auth
# =========================================================

@app.post("/api/auth/login")
def login(
    payload: LoginPayload,
    response: Response,
) -> dict[str, Any]:
    config = get_app_config()

    try:
        client, email = authenticate_user(
            config.supabase_url,
            config.supabase_key,
            payload.email,
            payload.password,
        )

    except Exception as error:
        raise HTTPException(
            status_code=401,
            detail=str(error),
        ) from error

    tokens = get_session_tokens(
        client
    )

    if tokens is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase hat keine gültige "
                "Sitzung zurückgegeben."
            ),
        )

    set_auth_cookies(
        response,
        tokens[0],
        tokens[1],
    )

    return {
        "authenticated": True,
        "email": email,
    }


@app.get("/api/auth/session")
def session(
    request: Request,
    response: Response,
) -> dict[str, Any]:
    access_token = str(
        request.cookies.get(
            ACCESS_COOKIE
        )
        or ""
    ).strip()

    refresh_token = str(
        request.cookies.get(
            REFRESH_COOKIE
        )
        or ""
    ).strip()

    if not access_token or not refresh_token:
        return {
            "authenticated": False,
            "email": None,
        }

    try:
        web_session = get_web_session(
            request,
            response,
        )

    except HTTPException:
        return {
            "authenticated": False,
            "email": None,
        }

    return {
        "authenticated": True,
        "email": web_session.email,
    }


@app.post("/api/auth/logout")
def logout(
    response: Response,
) -> dict[str, bool]:
    clear_auth_cookies(
        response
    )

    return {
        "logged_out": True,
    }


# =========================================================
# Inventar
# =========================================================

@app.get("/api/inventory")
def inventory(
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> list[dict[str, Any]]:
    repository = AssetRepository(
        web_session.client,
    )

    try:
        rows = repository.load_inventory()

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        ) from error

    result: list[dict[str, Any]] = []

    for row in rows:
        if not isinstance(row, dict):
            continue

        enriched = dict(row)

        enriched["_web_inventory_group"] = (
            get_inventory_group(row)
        )

        enriched["_web_category_key"] = (
            get_category_key(row)
        )

        enriched["_web_condition_key"] = (
            get_condition_key(row)
        )

        result.append(
            enriched
        )

    return result


# =========================================================
# Formular-Stammdaten
# =========================================================

@app.get("/api/inventory/form-data")
def inventory_form_data(
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> dict[str, Any]:
    repository = AssetRepository(
        web_session.client,
    )

    try:
        data = repository.load_create_form_data()

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        ) from error

    # Die Desktop-Oberfläche normalisiert ältere
    # Spezifikationsschlüssel ebenfalls vor der Anzeige.
    result = dict(data)

    normalized_models: list[dict[str, Any]] = []

    for source in data.get(
        "product_models",
        [],
    ):
        if not isinstance(source, dict):
            continue

        model = dict(source)

        model["specifications"] = normalize_specifications(
            model.get("specifications")
        )

        normalized_models.append(
            model
        )

    result["product_models"] = normalized_models

    return result


# =========================================================
# Inventareintrag erstellen
# =========================================================

@app.post("/api/inventory")
def create_inventory_entry(
    payload: dict[str, Any],
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> dict[str, Any]:
    repository = AssetRepository(
        web_session.client,
    )

    try:
        return repository.create_inventory_entry(
            payload
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error

    except Exception as error:
        message = str(error)
        normalized = message.casefold()

        status_code = (
            403
            if (
                "berechtig" in normalized
                or "row-level security" in normalized
                or "permission denied" in normalized
            )
            else 500
        )

        raise HTTPException(
            status_code=status_code,
            detail=message,
        ) from error


# =========================================================
# Inventar-Metadaten
# =========================================================

@app.get("/api/inventory/meta")
def inventory_meta(
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> dict[str, Any]:
    return {
        "column_order": list(
            PREFERRED_COLUMN_ORDER
        ),
        "default_visible_columns": list(
            DEFAULT_VISIBLE_COLUMNS
        ),
        "headers": dict(
            HEADER_LABELS
        ),
        "status_labels": dict(
            STATUS_LABELS
        ),
        "condition_labels": dict(
            CONDITION_LABELS
        ),
        "inventory_group_labels": dict(
            INVENTORY_GROUP_LABELS
        ),
    }