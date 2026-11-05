from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Request,
    Response,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import Client

from config import get_app_config
from infrastructure.asset_repository import AssetRepository
from infrastructure.data_transfer_service import DataTransferService
from infrastructure.qr_service import QrService
from infrastructure.stock_booking import StockWithdrawalRequired, book_stock
from infrastructure.supabase_client import (
    authenticate_user,
    get_session_tokens,
    restore_user_session,
)
from web_backend.settings_routes import create_settings_router
from web_backend.product_model_routes import create_product_models_router
from web_backend.recovery_routes import create_recovery_router
from web_backend.preferences_routes import create_preferences_router
from web_backend.archive_routes import ArchiveReason, create_archive_router
from web_backend.backup_routes import create_backup_router
from web_backend.inventory_paging import InventoryPageRequest, InventorySnapshots, filtered, options_for, page_token
from web_backend.rate_limits import LOGIN_LIMIT_MESSAGE, RateLimitMiddleware, RateLimits, account_key, retry_headers

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
    version="1.6.12",
)


# React-Produktionsbuild

PROJECT_ROOT = Path(
    __file__
).resolve().parents[2]

# .env muss bereits vor der CORS- und Cookie-Konfiguration geladen werden. get_app_config() wird erst später innerhalb der API-Routen aufgerufen und wäre dafür zu spät.
load_dotenv(
    PROJECT_ROOT / ".env",
    override=False,
)

WEB_DIST_DIR = (
    PROJECT_ROOT
    / "web"
    / "dist"
)

WEB_INDEX_FILE = (
    WEB_DIST_DIR
    / "index.html"
)

WEB_ASSETS_DIR = (
    WEB_DIST_DIR
    / "assets"
)

# Im Firmenbetrieb liefert IIS die React-WebApp aus. FastAPI soll dort nur noch die API bereitstellen. false: http://localhost:8000/ -> keine React-WebApp (404) /api/...               -> weiterhin aktiv true: FastAPI liefert zusätzlich web/dist aus. Dieser Modus ist beispielsweise für ein eigenständiges Test-/Abgabepaket ohne IIS gedacht.
SERVE_WEB_BUILD = (
    os.getenv(
        "ITASSETFLOW_SERVE_WEB",
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

print(
    "ITAssetFlow Web-Build über FastAPI:",
    "aktiv" if SERVE_WEB_BUILD else "deaktiviert (IIS/API-only)",
)


# CORS

DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://itassetflow.dlc-informatik.local",
]

configured_cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "ITASSETFLOW_CORS_ORIGINS",
        "",
    ).split(",")
    if origin.strip()
]

ALLOWED_CORS_ORIGINS = list(
    dict.fromkeys(
        [
            *DEFAULT_CORS_ORIGINS,
            *configured_cors_origins,
        ]
    )
)

# Zusätzlich dürfen bei Bedarf Ports am internen Hostnamen vorkommen. Der Browser-Origin der IIS-Seite ist normalerweise http://itassetflow.dlc-informatik.local, aber diese Regex macht lokale Testvarianten wie :80 oder :8080 ebenfalls unproblematisch.
CORS_ORIGIN_REGEX = os.getenv(
    "ITASSETFLOW_CORS_ORIGIN_REGEX",
    r"^https?://itassetflow\.dlc-informatik\.local(?::\d+)?$",
).strip()

print(
    "ITAssetFlow CORS origins:",
    ", ".join(
        ALLOWED_CORS_ORIGINS
    ),
)
print(
    "ITAssetFlow CORS regex:",
    CORS_ORIGIN_REGEX,
)

RATE_LIMITS = RateLimits()
app.add_middleware(RateLimitMiddleware, limits=RATE_LIMITS, render=os.getenv("RENDER") == "true")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_CORS_ORIGINS,
    allow_origin_regex=(
        CORS_ORIGIN_REGEX
        or None
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Retry-After"],
)


# Auth-Cookies

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


# Ereignisgesteuerte Multiuser-Synchronisation

class InventoryChangeBroker:
    """Verteilt kleine Änderungsereignisse an verbundene Webclients.

    Der Broker hält keine Inventardaten im Speicher. Er signalisiert lediglich,
    dass sich der zentrale Datenbestand geändert hat. Die betroffenen Browser
    laden daraufhin den aktuellen Stand über die bereits authentifizierte
    Inventar-API neu.

    Die Queues sind bewusst klein. Falls in kurzer Zeit mehrere Änderungen
    erfolgen, wird nur das neueste Ereignis benötigt, weil der Client danach
    ohnehin den aktuellen Gesamtstand lädt.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._revision = 0
        self._subscribers: dict[
            int,
            tuple[
                str,
                asyncio.AbstractEventLoop,
                asyncio.Queue[str],
            ],
        ] = {}

    def subscribe(
        self,
        client_id: str,
    ) -> tuple[int, asyncio.Queue[str], int]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str] = asyncio.Queue(
            maxsize=4,
        )
        token = id(queue)

        with self._lock:
            self._subscribers[token] = (
                client_id,
                loop,
                queue,
            )
            revision = self._revision

        return token, queue, revision

    def unsubscribe(
        self,
        token: int,
    ) -> None:
        with self._lock:
            self._subscribers.pop(
                token,
                None,
            )

    @staticmethod
    def _enqueue_latest(
        queue: asyncio.Queue[str],
        event: str,
    ) -> None:
        while queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        try:
            queue.put_nowait(
                event
            )
        except asyncio.QueueFull:
            # Falls zwischen Prüfung und Einfügen doch wieder gefüllt wurde, genügt das bereits wartende Änderungsereignis.
            pass

    def publish(
        self,
        source_client_id: str | None = None,
    ) -> None:
        normalized_source = str(
            source_client_id
            or ""
        ).strip()

        with self._lock:
            self._revision += 1
            revision = self._revision

            subscribers = list(
                self._subscribers.values()
            )

        data = json.dumps(
            {
                "revision": revision,
            },
            separators=(",", ":"),
        )

        event = (
            f"id: {revision}\n"
            "event: inventory-changed\n"
            f"data: {data}\n\n"
        )

        for (
            client_id,
            loop,
            queue,
        ) in subscribers:
            if (
                normalized_source
                and client_id
                and client_id
                == normalized_source
            ):
                # Der auslösende Client lädt nach seiner eigenen Änderung bereits gezielt neu. Dadurch vermeiden wir eine doppelte Datenbankabfrage auf diesem Browser.
                continue

            try:
                loop.call_soon_threadsafe(
                    self._enqueue_latest,
                    queue,
                    event,
                )
            except RuntimeError:
                # Event-Loop wurde bereits beendet. Der Subscriber wird beim Schliessen der Streaming-Verbindung entfernt.
                continue


INVENTORY_CHANGES = InventoryChangeBroker()


# Modelle

class LoginPayload(BaseModel):
    email: str = Field(max_length=320)
    password: str


class DeleteInventoryPayload(BaseModel):
    entry_keys: list[str]
    reason: ArchiveReason


APP_ROLES = {
    "admin",
    "user",
    "viewer",
}


@dataclass
class WebSession:
    client: Client
    email: str
    role: str


# Allgemeine Helfer

def _normalize_text(
    value: Any,
) -> str:
    return str(
        value or ""
    ).strip().casefold()



def _request_client_id(
    request: Request,
) -> str | None:
    value = str(
        request.headers.get(
            "X-ITAssetFlow-Client-ID",
            "",
        )
        or ""
    ).strip()

    if not value:
        return None

    # Begrenzung verhindert, dass beliebig grosse Headerwerte im Broker gespeichert oder weiterverarbeitet werden.
    return value[:128]


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

    parts = normalized_key.split(":")
    if len(parts) == 2 and parts[0] == "asset" and parts[1].isascii() and parts[1].isdigit():
        return {"_record_type": "asset", "id": int(parts[1])}
    if len(parts) == 8 and parts[:2] == ["stock", "stock"] and parts[2:5] == parts[5:8]:
        parts = ["stock", *parts[2:5]]
    if (len(parts) == 4 and parts[0] == "stock"
            and all(value.isascii() and value.isdigit() for value in parts[1:3])
            and parts[3] in {"new", "like_new", "used", "worn", "defective"}):
        model_id, location_id = map(int, parts[1:3])
        return {"_record_type": "stock", "id": ":".join(parts),
                "product_model_id": model_id, "storage_location_id": location_id, "condition": parts[3]}

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
    if isinstance(error, StockWithdrawalRequired):
        return HTTPException(409, detail={
            "code": "stock_withdrawal_required", "message": str(error), "available": error.available,
        })
    code = str(getattr(error, "code", ""))
    message = str(getattr(error, "message", None) or error)
    normalized = message.casefold()
    if code in {"40001", "P0041"}:
        try:
            balance = Decimal(str(getattr(error, "details", "")))
        except InvalidOperation:
            balance = Decimal("NaN")
        if balance.is_finite() and balance >= 0:
            return HTTPException(409, detail={
                "code": "stock_conflict" if code == "40001" else "stock_withdrawal_required",
                "message": f"{message} Aktuell verfügbar: {balance.normalize():f} Stück.",
                "available": float(balance),
            })
    if code == "PGRST202" and any(name in message for name in ("save_inventory_entry", "move_inventory_entry")):
        if "save_inventory_entry_with_upc" in message:
            return HTTPException(503, detail="Für die UPC muss die aktuelle database/scanner_codes.sql in Supabase ausgeführt werden.")
        return HTTPException(503, detail="Die Datenbank dieses Servers benötigt das aktuelle ITAssetFlow-Update.")
    if code in {"40001", "23505"}:
        status_code = 409
    elif code == "42501":
        status_code = 403
    elif code in {"P0001", "23514", "22P02", "22001", "22003", "22007"}:
        status_code = 400
    elif isinstance(
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


# Cookie-Helfer

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


# Rollen / Berechtigungen

def _load_app_role(
    client: Client,
    email: str,
) -> str:
    """Liest die aktive ITAssetFlow-Rolle des angemeldeten Benutzers.

    Die Rolle liegt bewusst in ``public.employees`` und wird bei jedem
    API-Request erneut aus der Datenbank gelesen. Änderungen durch einen
    Administrator greifen dadurch ohne neue Anmeldung auf der Serverseite.
    """

    try:
        response = (
            client
            .table(
                "employees"
            )
            .select(
                "app_role,is_active,auth_user_id"
            )
            .eq(
                "email",
                email,
            )
            .limit(
                1
            )
            .execute()
        )

    except Exception as error:
        raise HTTPException(
            status_code=403,
            detail=(
                "Die Benutzerberechtigung konnte nicht geprüft werden."
            ),
        ) from error

    data = getattr(
        response,
        "data",
        None,
    )

    rows = [
        row
        for row in data
        if isinstance(
            row,
            dict,
        )
    ] if isinstance(
        data,
        list,
    ) else []

    if not rows:
        raise HTTPException(
            status_code=403,
            detail=(
                "Dieses Benutzerkonto ist nicht für ITAssetFlow freigegeben."
            ),
        )

    row = rows[0]

    if not bool(
        row.get(
            "is_active",
            False,
        )
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Dieses ITAssetFlow-Benutzerkonto ist deaktiviert."
            ),
        )

    if not row.get(
        "auth_user_id"
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Dieses Benutzerkonto ist nicht mit Supabase Auth verknüpft."
            ),
        )

    role = str(
        row.get(
            "app_role",
        )
        or ""
    ).strip().casefold()

    if role not in APP_ROLES:
        raise HTTPException(
            status_code=403,
            detail=(
                "Für dieses Benutzerkonto ist keine gültige Rolle hinterlegt."
            ),
        )

    return role


# Web-Sitzung

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

    role = _load_app_role(
        client,
        email,
    )

    return WebSession(
        client=client,
        email=email,
        role=role,
    )


def require_editor_session(
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> WebSession:
    if web_session.role not in {
        "admin",
        "user",
    }:
        raise HTTPException(
            status_code=403,
            detail=(
                "Dieses Benutzerkonto besitzt nur Leserechte."
            ),
        )

    return web_session


def require_admin_session(
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> WebSession:
    if web_session.role != "admin":
        raise HTTPException(
            status_code=403,
            detail=(
                "Für diese Funktion sind Administratorrechte erforderlich."
            ),
        )

    return web_session


# Allgemein

@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "application": "ITAssetFlow",
    }


# Auth

@app.post("/api/auth/login")
def login(
    payload: LoginPayload,
    response: Response,
) -> dict[str, Any]:
    retry = RATE_LIMITS.login_account.consume(account_key(payload.email))
    if retry:
        raise HTTPException(429, LOGIN_LIMIT_MESSAGE, headers=retry_headers(retry))

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

    role = _load_app_role(
        client,
        email,
    )

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
        "role": role,
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
            "role": None,
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
            "role": None,
        }

    return {
        "authenticated": True,
        "email": web_session.email,
        "role": web_session.role,
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


# Inventar laden

_inventory_snapshots = InventorySnapshots()
_UNTRACKED_REVISION = -1


def _load_inventory_rows(client: Client) -> list[dict[str, Any]]:
    return [_enrich_inventory_row(row) for row in AssetRepository(client).load_inventory() if isinstance(row, dict)]


def _read_inventory_revision(client: Client) -> int:
    try:
        result = client.table("inventory_change_state").select("revision").eq("id", 1).limit(1).execute()
    except APIError as error:
        # This optional counter must not prevent a fresh RLS-scoped read.
        if error.code in {"PGRST205", "42P01", "42501"}:
            return _UNTRACKED_REVISION
        raise
    data = result.data
    if data == []:
        return _UNTRACKED_REVISION
    if not isinstance(data, list) or not isinstance(data[0], dict):
        raise RuntimeError("Der Änderungsstand des Inventars konnte nicht gelesen werden.")
    return int(data[0]["revision"])


@app.get("/api/inventory")
def inventory(response: Response, web_session: WebSession = Depends(get_web_session)) -> list[dict[str, Any]]:
    response.headers["Cache-Control"] = "no-store"
    try:
        return _load_inventory_rows(web_session.client)
    except Exception as error:
        raise _repository_http_exception(error) from error


@app.post("/api/inventory/page")
def inventory_page(payload: InventoryPageRequest, request: Request, response: Response,
                   web_session: WebSession = Depends(get_web_session)) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    cookie = request.cookies.get(REFRESH_COOKIE, "")
    identity = sha256(f"{cookie}:{web_session.email}:{web_session.role}".encode()).hexdigest()
    # Check the live DB revision on every page, including cache hits. Changes
    # to employees, location grants and item locations also bump this revision.
    try:
        revision = _read_inventory_revision(web_session.client)
        tracked = revision != _UNTRACKED_REVISION
        token = page_token(identity, revision, payload.query) if tracked else None
        rows = None
        if tracked:
            if payload.offset and payload.snapshot != token:
                raise HTTPException(409, "Das Inventar wurde geändert. Die Liste wird neu geladen.")
            if cookie and not (payload.refresh and payload.offset == 0):
                rows = _inventory_snapshots.get(identity, revision)
        if rows is None:
            rows = _load_inventory_rows(web_session.client)
            if tracked and _read_inventory_revision(web_session.client) != revision:
                raise HTTPException(409, "Das Inventar wurde während des Abrufs geändert. Bitte erneut laden.")
            if tracked and cookie:
                _inventory_snapshots.put(identity, revision, rows)
        matches = filtered(rows, payload.query)
        if not tracked:
            token = page_token(identity, revision, payload.query, matches)
            if payload.offset and payload.snapshot != token:
                raise HTTPException(409, "Das Inventar wurde geändert. Die Liste wird neu geladen.")
    except HTTPException:
        raise
    except Exception as error:
        raise _repository_http_exception(error) from error
    end = payload.offset + payload.limit
    return {
        "rows": matches[payload.offset:end], "next_offset": end if end < len(matches) else None,
        "total": len(rows), "matched": len(matches), "revision": revision, "snapshot": token,
        "options": options_for(rows) if payload.offset == 0 else None,
    }


@app.get("/api/inventory/dashboard")
def inventory_dashboard(
    response: Response, web_session: WebSession = Depends(get_web_session),
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    try:
        data = web_session.client.rpc("inventory_dashboard", {}).execute().data
        if not isinstance(data, dict) or not isinstance(data.get("sites"), list):
            raise RuntimeError("Ungültige Dashboard-Antwort.")
        return data
    except Exception as error:
        logging.getLogger(__name__).exception("Dashboard-Abfrage fehlgeschlagen")
        raise HTTPException(503, "Das Dashboard konnte nicht geladen werden. Bitte erneut versuchen.") from error


@app.get(
    "/api/inventory/events",
    include_in_schema=False,
)
async def inventory_events(
    request: Request,
    client_id: str = "",
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> StreamingResponse:
    # Die Dependency dient der Authentifizierung. Die eigentliche Streaming-Verbindung benötigt danach keinen direkten Supabase-Zugriff.
    del web_session

    normalized_client_id = str(
        client_id
        or ""
    ).strip()[:128]

    async def event_stream():
        (
            token,
            queue,
            revision,
        ) = INVENTORY_CHANGES.subscribe(
            normalized_client_id
        )

        ready_data = json.dumps(
            {
                "revision": revision,
            },
            separators=(",", ":"),
        )

        try:
            # "ready" bestätigt nur die Verbindung. Der Client führt dadurch keinen zusätzlichen Reload beim normalen Seitenstart aus.
            yield (
                "event: ready\n"
                f"data: {ready_data}\n\n"
            )

            while True:
                if await request.is_disconnected():
                    break

                try:
                    event = await asyncio.wait_for(
                        queue.get(),
                        timeout=20.0,
                    )

                except asyncio.TimeoutError:
                    # Ein Kommentar hält die HTTP-Verbindung durch Proxies, Firewalls und Browser hinweg aktiv, ohne Datenbankarbeit auszulösen.
                    yield ": keep-alive\n\n"
                    continue

                yield event

        finally:
            INVENTORY_CHANGES.unsubscribe(
                token
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



# Performance-schonende Änderungsprüfung

@app.get("/api/inventory/revision")
def inventory_revision(
    response: Response,
    web_session: WebSession = Depends(
        get_web_session
    ),
) -> dict[str, int]:
    """Liefert nur den technischen Änderungsstand des Inventars.

    Die Datenbank führt in ``inventory_change_state`` genau eine kleine
    Revisionsnummer. Datenbank-Trigger erhöhen sie bei relevanten Änderungen.
    Die Webclients können deshalb alle fünf Sekunden nur diesen einzelnen Wert
    prüfen und müssen die vollständige Inventarliste nur bei einer tatsächlichen
    Änderung neu laden.
    """

    response.headers["Cache-Control"] = "no-store"
    try:
        return {"revision": _read_inventory_revision(web_session.client)}
    except Exception as error:
        raise _repository_http_exception(error) from error


# Formular-Stammdaten

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
    response: Response,
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

    response.headers["Cache-Control"] = "no-store"
    return _normalize_form_data(data)


# Inventareintrag erstellen / bearbeiten / löschen

@app.get("/api/scanner/lookup")
@app.get("/api/qr/lookup")
def lookup_qr(code: str, code_type: str = "auto", web_session: WebSession = Depends(get_web_session)) -> dict[str, Any]:
    try:
        return QrService(web_session.client, actor_email=web_session.email).lookup(code, code_type)
    except Exception as error:
        raise _repository_http_exception(error) from error


@app.post("/api/scanner/stock")
@app.post("/api/qr/stock")
def adjust_qr_stock(
    request: Request,
    payload: dict[str, Any],
    web_session: WebSession = Depends(require_editor_session),
) -> dict[str, Any]:
    try:
        result = QrService(web_session.client, actor_email=web_session.email).adjust(payload)
        INVENTORY_CHANGES.publish(_request_client_id(request))
        return result
    except Exception as error:
        if "nicht genügend lagerbestand" in str(error).casefold():
            raise HTTPException(status_code=409, detail="Nicht genügend Lagerbestand. Bitte den aktuellen Bestand erneut prüfen.") from error
        raise _repository_http_exception(error) from error

@app.post("/api/inventory")
def create_inventory_entry(
    request: Request,
    payload: dict[str, Any],
    web_session: WebSession = Depends(
        require_editor_session
    ),
) -> dict[str, Any]:
    repository = AssetRepository(
        web_session.client,
    )

    try:
        result = repository.create_inventory_entry(
            payload
        )

        INVENTORY_CHANGES.publish(
            _request_client_id(
                request
            )
        )

        return result

    except Exception as error:
        raise _repository_http_exception(
            error
        ) from error


@app.put("/api/inventory")
def update_inventory_entry(
    request: Request,
    payload: dict[str, Any],
    web_session: WebSession = Depends(
        require_editor_session
    ),
) -> dict[str, Any]:
    repository = AssetRepository(
        web_session.client,
    )

    try:
        result = repository.update_inventory_entry(
            payload
        )

        INVENTORY_CHANGES.publish(
            _request_client_id(
                request
            )
        )

        return result

    except Exception as error:
        raise _repository_http_exception(
            error
        ) from error


@app.post("/api/inventory/stock")
def change_inventory_stock(request: Request, payload: dict[str, Any],
                           web_session: WebSession = Depends(require_editor_session)) -> dict[str, Any]:
    try:
        result = book_stock(web_session.client, payload)
        INVENTORY_CHANGES.publish(_request_client_id(request))
        return result
    except Exception as error:
        raise _repository_http_exception(error) from error


class MoveInventoryPayload(BaseModel):
    request_id: UUID
    entry_key: str = Field(min_length=1, max_length=160)
    destination_id: int = Field(gt=0)
    quantity: int | None = Field(default=None, gt=0, le=1000000)
    expected_quantity: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    expected_location_id: int | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=2000)


@app.post("/api/inventory/move")
def move_inventory_entry(request: Request, payload: MoveInventoryPayload,
                         web_session: WebSession = Depends(require_editor_session)) -> dict[str, Any]:
    repository = AssetRepository(web_session.client)
    try:
        entry = _find_inventory_entry(repository, payload.entry_key)
        key = entry["id"] if entry.get("_record_type") == "stock" else f"asset:{entry['id']}"
        result = web_session.client.rpc("move_inventory_entry", {
            "p_key": key, "p_destination": payload.destination_id, "p_request_id": str(payload.request_id),
            "p_quantity": payload.quantity, "p_expected_quantity": payload.expected_quantity,
            "p_expected_location": payload.expected_location_id, "p_note": payload.note,
        }).execute().data
        if not isinstance(result, dict) or result.get("saved") is not True:
            raise RuntimeError("Die Umlagerung wurde nicht bestätigt.")
        INVENTORY_CHANGES.publish(_request_client_id(request))
        return result
    except Exception as error:
        raise _repository_http_exception(error) from error


@app.post("/api/inventory/delete")
def delete_inventory_entries(
    request: Request,
    payload: DeleteInventoryPayload,
    web_session: WebSession = Depends(
        require_editor_session
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
        selected = [_find_inventory_entry(repository, key) for key in keys]
        result = repository.delete_inventory_entries(selected, payload.reason)

        INVENTORY_CHANGES.publish(
            _request_client_id(
                request
            )
        )

        return result

    except Exception as error:
        raise _repository_http_exception(
            error
        ) from error


class BulkAssetEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["asset"]
    id: int = Field(gt=0)
    updated_at: str | None = Field(default=None, max_length=64)


class BulkStockEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["stock"]
    product_model_id: int = Field(gt=0)
    storage_location_id: int = Field(gt=0)
    condition: Literal["new", "like_new", "used", "worn", "defective"]
    quantity: float = Field(gt=0, allow_inf_nan=False)


class BulkEditPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entries: list[Annotated[BulkAssetEntry | BulkStockEntry, Field(discriminator="type")]] = Field(min_length=2, max_length=200)
    changes: dict[str, str | int | float | None] = Field(min_length=1, max_length=6)


@app.patch("/api/inventory/bulk")
def bulk_edit_inventory(request: Request, payload: BulkEditPayload,
                        web_session: WebSession = Depends(require_editor_session)) -> dict[str, int]:
    try:
        updated = web_session.client.rpc("bulk_edit_inventory", {
            "p_entries": [entry.model_dump(exclude_none=True) for entry in payload.entries],
            "p_changes": payload.changes,
        }).execute().data
        if type(updated) is not int or not 0 <= updated <= len(payload.entries):
            raise RuntimeError("Die Datenbank hat die Sammelbearbeitung nicht bestätigt.")
        if updated:
            INVENTORY_CHANGES.publish(_request_client_id(request))
        return {"updated_count": updated}
    except Exception as error:
        raise _repository_http_exception(error) from error


# Datenexport / CSV-Import

@app.get("/api/transfer/export/{export_format}")
def export_data(
    export_format: Literal["csv", "postgresql", "csv-tables", "excel"],
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

    suffix, content_type, export = {
        "csv": (".csv", "text/csv; charset=utf-8", service.export_csv),
        "postgresql": (".sql", "application/sql; charset=utf-8", service.export_postgresql),
        "csv-tables": (".zip", "application/zip", service.export_csv_tables),
        "excel": (".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", service.export_excel),
    }[export_format]
    filename = f"ITAssetFlow_{timestamp}{suffix}"

    temporary_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(
            prefix="itassetflow_export_",
            suffix=suffix,
            delete=False,
        ) as handle:
            temporary_path = Path(
                handle.name
            )

        export(temporary_path)

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
        media_type=content_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"'
            ),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.post("/api/transfer/import/csv")
async def import_csv(
    request: Request,
    web_session: WebSession = Depends(
        require_admin_session
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

        result = service.import_csv(
            temporary_path
        )

        INVENTORY_CHANGES.publish(
            _request_client_id(
                request
            )
        )

        return result

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


# Inventar-Metadaten

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

# Einstellungen und Produktmodelle

app.include_router(create_recovery_router(clear_auth_cookies, ALLOWED_CORS_ORIGINS, RATE_LIMITS.recovery_account))
app.include_router(create_preferences_router(get_web_session))
app.include_router(create_backup_router(require_admin_session))
app.include_router(create_archive_router(get_web_session, require_editor_session, require_admin_session, INVENTORY_CHANGES.publish))
app.include_router(
    create_settings_router(
        require_admin_session,
        INVENTORY_CHANGES.publish,
    )
)
app.include_router(
    create_product_models_router(
        require_admin_session,
        INVENTORY_CHANGES.publish,
    )
)
# React-WebApp / SPA

WEB_MEDIA_TYPES: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
}


def _web_file_response(
    path: Path,
) -> FileResponse:
    media_type = WEB_MEDIA_TYPES.get(
        path.suffix.casefold()
    )

    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "no-cache"} if path.suffix.casefold() == ".html" else None,
    )


def _require_web_build() -> None:
    if not WEB_INDEX_FILE.is_file():
        raise HTTPException(
            status_code=503,
            detail=(
                "Der React-Produktionsbuild wurde nicht gefunden. "
                "Bitte im Ordner 'web' zuerst "
                "'npm run build' ausführen."
            ),
        )


def _safe_dist_file(
    relative_path: str,
) -> Path | None:
    try:
        dist_root = (
            WEB_DIST_DIR.resolve()
        )

        candidate = (
            WEB_DIST_DIR
            / relative_path
        ).resolve()

        candidate.relative_to(
            dist_root
        )

    except (
        OSError,
        ValueError,
    ):
        return None

    if candidate.is_file():
        return candidate

    return None


if SERVE_WEB_BUILD:
    @app.get(
        "/",
        include_in_schema=False,
    )
    def web_root() -> FileResponse:
        _require_web_build()

        return _web_file_response(
            WEB_INDEX_FILE
        )


    @app.get(
        "/{full_path:path}",
        include_in_schema=False,
    )
    def web_spa(
        full_path: str,
    ) -> FileResponse:
        _require_web_build()

        normalized_path = str(
            full_path or ""
        ).lstrip("/")

        # Nicht vorhandene API-Routen dürfen niemals auf index.html fallen, sonst würde ein API-Fehler wie eine HTML-Seite aussehen.
        if (
            normalized_path == "api"
            or normalized_path.startswith(
                "api/"
            )
        ):
            raise HTTPException(
                status_code=404,
                detail="API-Endpunkt nicht gefunden.",
            )

        static_file = _safe_dist_file(
            normalized_path
        )

        if static_file is not None:
            return _web_file_response(
                static_file
            )

        # Requests auf konkrete Dateien wie .png/.css/.js nicht auf React zurückfallen lassen, wenn die Datei nicht existiert.
        if Path(
            normalized_path
        ).suffix:
            raise HTTPException(
                status_code=404,
                detail="Datei nicht gefunden.",
            )

        # React Router übernimmt Client-Routen wie: /login /inventory /inventory/new /inventory/<key>/edit /settings
        return _web_file_response(
            WEB_INDEX_FILE
        )
else:
    # Absichtlich keine Route für "/" oder React-Client-Routen registrieren. Dadurch kann Port 8000 im IIS-Betrieb nicht mehr als zweite, möglicherweise veraltete Weboberfläche verwendet werden.
    pass
