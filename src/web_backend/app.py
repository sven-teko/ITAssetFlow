from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
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
from infrastructure.data_transfer_service import DataTransferService
from infrastructure.supabase_client import (
    authenticate_user,
    get_session_tokens,
    restore_user_session,
)
from web_backend.settings_routes import create_settings_router

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

MAX_CSV_IMPORT_BYTES = 50 * 1024 * 1024


# =========================================================
# Modelle
# =========================================================

class LoginPayload(BaseModel):
    email: str
    password: str


class DeleteInventoryPayload(BaseModel):
    entry_keys: list[str]


@dataclass
class WebSession:
    client: Client
    email: str


# =========================================================
# Allgemeine Helfer
# =========================================================

def _normalize_text(
    value: Any,
) -> str:
    return str(
        value or ""
    ).strip().casefold()


def _inventory_row_key(
    row: dict[str, Any],
) -> str:
    record_type = _normalize_text(
        row.get("_record_type")
        or "asset"
    )

    if record_type == "stock":
        return ":".join(
            [
                "stock",
                str(row.get("id") or ""),
                str(row.get("product_model_id") or ""),
                str(row.get("storage_location_id") or ""),
                str(row.get("condition") or ""),
            ]
        )

    return ":".join(
        [
            "asset",
            str(
                row.get("id")
                or row.get("asset_tag")
                or row.get("serial_number")
                or ""
            ),
        ]
    )


def _enrich_inventory_row(
    row: dict[str, Any],
) -> dict[str, Any]:
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

    return enriched


def _normalize_form_data(
    data: dict[str, Any],
) -> dict[str, Any]:
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

    edit_entry = result.get(
        "edit_entry"
    )

    if isinstance(
        edit_entry,
        dict,
    ):
        normalized_entry = dict(
            edit_entry
        )

        normalized_entry["specifications"] = (
            normalize_specifications(
                normalized_entry.get(
                    "specifications"
                )
            )
        )

        result["edit_entry"] = (
            normalized_entry
        )

    return result


def _find_inventory_entry(
    repository: AssetRepository,
    entry_key: str,
) -> dict[str, Any]:
    normalized_key = str(
        entry_key or ""
    ).strip()

    if not normalized_key:
        raise ValueError(
            "Inventarschlüssel fehlt."
        )

    for row in repository.load_inventory():
        if (
            isinstance(row, dict)
            and _inventory_row_key(row)
            == normalized_key
        ):
            return row

    raise ValueError(
        "Der ausgewählte Inventareintrag "
        "existiert nicht mehr."
    )


def _repository_http_exception(
    error: Exception,
    *,
    value_error_status: int = 400,
) -> HTTPException:
    message = str(error)
    normalized = message.casefold()

    if isinstance(
        error,
        ValueError,
    ):
        status_code = value_error_status

    elif (
        "berechtig" in normalized
        or "row-level security" in normalized
        or "permission denied" in normalized
    ):
        status_code = 403

    else:
        status_code = 500

    return HTTPException(
        status_code=status_code,
        detail=message,
    )


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
# Inventar laden
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
        raise _repository_http_exception(
            error
        ) from error

    return [
        _enrich_inventory_row(row)
        for row in rows
        if isinstance(row, dict)
    ]


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
        raise _repository_http_exception(
            error
        ) from error

    return _normalize_form_data(
        data
    )


@app.get("/api/inventory/edit-form-data")
def inventory_edit_form_data(
    entry_key: str,
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> dict[str, Any]:
    repository = AssetRepository(
        web_session.client,
    )

    try:
        entry = _find_inventory_entry(
            repository,
            entry_key,
        )

        data = repository.load_edit_form_data(
            entry
        )

    except Exception as error:
        raise _repository_http_exception(
            error,
            value_error_status=404,
        ) from error

    return _normalize_form_data(
        data
    )


# =========================================================
# Inventareintrag erstellen / bearbeiten / löschen
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

    except Exception as error:
        raise _repository_http_exception(
            error
        ) from error


@app.put("/api/inventory")
def update_inventory_entry(
    payload: dict[str, Any],
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> dict[str, Any]:
    repository = AssetRepository(
        web_session.client,
    )

    try:
        return repository.update_inventory_entry(
            payload
        )

    except Exception as error:
        raise _repository_http_exception(
            error
        ) from error


@app.post("/api/inventory/delete")
def delete_inventory_entries(
    payload: DeleteInventoryPayload,
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> dict[str, int]:
    keys = [
        str(key).strip()
        for key in payload.entry_keys
        if str(key).strip()
    ]

    if not keys:
        raise HTTPException(
            status_code=400,
            detail=(
                "Keine Inventareinträge "
                "zum Löschen ausgewählt."
            ),
        )

    repository = AssetRepository(
        web_session.client,
    )

    try:
        current_rows = [
            row
            for row in repository.load_inventory()
            if isinstance(row, dict)
        ]

        rows_by_key = {
            _inventory_row_key(row): row
            for row in current_rows
        }

        selected: list[
            dict[str, Any]
        ] = []

        missing: list[str] = []

        for key in keys:
            row = rows_by_key.get(
                key
            )

            if row is None:
                missing.append(
                    key
                )
                continue

            selected.append(
                row
            )

        if missing:
            raise ValueError(
                "Mindestens ein ausgewählter "
                "Inventareintrag existiert nicht mehr. "
                "Bitte die Tabelle aktualisieren."
            )

        return repository.delete_inventory_entries(
            selected
        )

    except Exception as error:
        raise _repository_http_exception(
            error
        ) from error


# =========================================================
# CSV Import / Export
# =========================================================

@app.get("/api/transfer/export/csv")
def export_csv(
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> Response:
    service = DataTransferService(
        web_session.client,
    )

    timestamp = datetime.now().strftime(
        "%Y-%m-%d_%H-%M-%S"
    )

    filename = (
        f"ITAssetFlow_{timestamp}.csv"
    )

    temporary_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(
            prefix="itassetflow_export_",
            suffix=".csv",
            delete=False,
        ) as handle:
            temporary_path = Path(
                handle.name
            )

        service.export_csv(
            temporary_path
        )

        content = temporary_path.read_bytes()

    except Exception as error:
        raise _repository_http_exception(
            error
        ) from error

    finally:
        if (
            temporary_path is not None
            and temporary_path.exists()
        ):
            try:
                temporary_path.unlink()
            except OSError:
                pass

    return Response(
        content=content,
        media_type=(
            "text/csv; charset=utf-8"
        ),
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"'
            ),
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/transfer/import/csv")
async def import_csv(
    request: Request,
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> dict[str, Any]:
    content = await request.body()

    if not content:
        raise HTTPException(
            status_code=400,
            detail=(
                "Die ausgewählte CSV-Datei "
                "ist leer."
            ),
        )

    if len(content) > MAX_CSV_IMPORT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                "Die CSV-Datei ist zu gross. "
                "Maximal erlaubt sind 50 MB."
            ),
        )

    service = DataTransferService(
        web_session.client,
    )

    temporary_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(
            prefix="itassetflow_import_",
            suffix=".csv",
            delete=False,
        ) as handle:
            handle.write(
                content
            )

            temporary_path = Path(
                handle.name
            )

        return service.import_csv(
            temporary_path
        )

    except Exception as error:
        raise _repository_http_exception(
            error
        ) from error

    finally:
        if (
            temporary_path is not None
            and temporary_path.exists()
        ):
            try:
                temporary_path.unlink()
            except OSError:
                pass


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

# =========================================================
# Einstellungen
# =========================================================

app.include_router(
    create_settings_router(
        get_web_session
    )
)

