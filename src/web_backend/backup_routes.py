"""Administrator download and preparation of a recovery script."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import gzip
from io import BytesIO
import json
import zlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

MAX_COMPRESSED_BYTES = 30 * 1024 * 1024
MAX_DECODED_BYTES = 100 * 1024 * 1024
FORMAT = "ITAssetFlow-Backup"


def _validate_backup(snapshot: object) -> dict:
    if not isinstance(snapshot, dict) or snapshot.get("format") != FORMAT or snapshot.get("version") != 1:
        raise ValueError("Diese Datei ist kein unterstütztes ITAssetFlow-Backup.")
    from infrastructure.data_transfer_service import TABLE_ORDER

    tables = snapshot.get("tables")
    if not isinstance(tables, dict) or set(tables) != {*TABLE_ORDER, "audit_log", "inventory_stock_requests"}:
        raise ValueError("Das Backup ist unvollständig oder gehört zu einer anderen Version.")
    for rows in tables.values():
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError("Das Backup enthält ungültige Tabellendaten.")
    return snapshot


def _serialize(snapshot: object) -> bytes:
    return json.dumps(_validate_backup(snapshot), ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def _prepare_recovery(compressed: bytes | bytearray, keep_auth_links: bool) -> bytes:
    try:
        with gzip.GzipFile(fileobj=BytesIO(compressed)) as stream:
            content = stream.read(MAX_DECODED_BYTES + 1)
        if len(content) > MAX_DECODED_BYTES:
            raise ValueError("Das entpackte Backup überschreitet 100 MB.")
        snapshot = _validate_backup(json.loads(content))
        payload = base64.b64encode(_serialize(snapshot)).decode("ascii")
    except (OSError, EOFError, UnicodeError, RecursionError, zlib.error) as error:
        raise ValueError("Die Sicherungsdatei konnte nicht gelesen werden.") from error
    return (
        "-- ITAssetFlow: Als Datenbankinhaber in einer leeren, vorbereiteten Zieldatenbank ausführen.\n"
        "BEGIN;\n"
        f"SELECT private.restore_inventory_backup(convert_from(decode('{payload}','base64'),'UTF8')::jsonb,"
        f"{'true' if keep_auth_links else 'false'}) AS wiederhergestellte_zeilen;\n"
        "COMMIT;\n"
    ).encode("utf-8")


def create_backup_router(require_admin_session):
    router = APIRouter(prefix="/api/backup", tags=["backup"])

    def download_response(payload: bytes, media_type: str, suffix: str) -> Response:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%SZ")
        return Response(payload, media_type=media_type, headers={
            "Content-Disposition": f'attachment; filename="ITAssetFlow_{stamp}.{suffix}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        })

    @router.get("/download")
    def create_backup(web_session=Depends(require_admin_session)):
        try:
            snapshot = web_session.client.rpc("create_inventory_backup", {}).execute().data
            content = _serialize(snapshot)
            if len(content) > MAX_DECODED_BYTES:
                raise HTTPException(413, "Die Sicherung ist für den Download hier zu gross. Verwende den GitHub-Workflow.")
            payload = gzip.compress(content, compresslevel=6, mtime=0)
            if len(payload) > MAX_COMPRESSED_BYTES:
                raise HTTPException(413, "Die Sicherung ist für den Download hier zu gross. Verwende den GitHub-Workflow.")
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(503, "Die Datenbanksicherung konnte nicht erstellt werden.") from error
        return download_response(payload, "application/gzip", "json.gz")

    @router.post("/recovery-sql")
    async def prepare_recovery(request: Request, keep_auth_links: bool = False,
                               _web_session=Depends(require_admin_session)):
        content = bytearray()
        async for chunk in request.stream():
            if len(content) + len(chunk) > MAX_COMPRESSED_BYTES:
                raise HTTPException(413, "Die Sicherungsdatei darf höchstens 30 MB gross sein.")
            content.extend(chunk)
        if not content:
            raise HTTPException(400, "Bitte eine Sicherungsdatei auswählen.")
        try:
            payload = await run_in_threadpool(_prepare_recovery, content, keep_auth_links)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return download_response(payload, "application/sql", "restore.sql")

    return router
