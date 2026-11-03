"""Standortgeschütztes Archiv und optionale Artikelbilder."""
import base64

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from infrastructure.archive_reason import ArchiveReason


def create_archive_router(get_web_session, require_editor_session):
    router = APIRouter(prefix="/api", tags=["archive", "images"])

    def change_image(web_session, key, data):
        try:
            return web_session.client.rpc("set_inventory_image", {"p_key": key, "p_image_data": data}).execute().data
        except Exception as error:
            if str(getattr(error, "code", "")) == "42501":
                raise HTTPException(403, "Der Artikel ist nicht mehr verfügbar oder nicht freigegeben.") from error
            raise HTTPException(503, "Das Artikelbild konnte nicht gespeichert werden. Bitte erneut versuchen.") from error

    @router.get("/archive")
    def archive(response: Response, offset: int = Query(0, ge=0), web_session=Depends(get_web_session)):
        result = (web_session.client.table("inventory_archive").select("*", count="exact")
                  .order("archived_at", desc=True).order("id", desc=True).range(offset, offset+49).execute())
        response.headers["Cache-Control"] = "no-store"
        return {"items": result.data or [], "total": result.count or 0}

    @router.get("/images/{image_id}")
    def image(image_id: str, web_session=Depends(get_web_session)):
        from uuid import UUID
        try:
            identifier = str(UUID(image_id))
        except ValueError as error:
            raise HTTPException(404, "Bild nicht gefunden.") from error
        rows = (web_session.client.table("inventory_images").select("image_data,content_type")
                .eq("id", identifier).limit(1).execute()).data or []
        if not rows:
            raise HTTPException(404, "Bild nicht gefunden oder nicht freigegeben.")
        return Response(base64.b64decode(rows[0]["image_data"]), media_type="image/webp",
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @router.post("/inventory/{entry_key}/image")
    async def save_image(entry_key: str, request: Request, web_session=Depends(require_editor_session)):
        if request.headers.get("content-type", "").split(";")[0] != "image/webp":
            raise HTTPException(415, "Bitte ein JPG-, PNG- oder WebP-Bild auswählen.")
        chunks = bytearray()
        async for chunk in request.stream():
            if len(chunks) + len(chunk) > 1048576:
                raise HTTPException(413, "Das aufbereitete Artikelbild darf höchstens 1 MB gross sein.")
            chunks.extend(chunk)
        content = bytes(chunks)
        if not 20 <= len(content) <= 1048576:
            raise HTTPException(413, "Das aufbereitete Artikelbild darf höchstens 1 MB gross sein.")
        if content[:4] != b"RIFF" or content[8:12] != b"WEBP" or int.from_bytes(content[4:8], "little")+8 != len(content):
            raise HTTPException(400, "Die Bilddatei ist ungültig.")
        return {"image_id": change_image(web_session, entry_key, base64.b64encode(content).decode("ascii"))}

    @router.delete("/inventory/{entry_key}/image")
    def remove_image(entry_key: str, web_session=Depends(require_editor_session)):
        change_image(web_session, entry_key, None)
        return {"image_id": None}

    return router
