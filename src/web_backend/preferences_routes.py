"""Persönliche Tabellenansicht im Profil des angemeldeten Benutzers."""
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

PREFERENCE_KEY = "itassetflow_inventory_columns_v1"
ColumnName = Annotated[str, Field(strict=True, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_]+$")]


class InventoryColumns(BaseModel):
    model_config = ConfigDict(extra="forbid")
    column_order: list[ColumnName] = Field(min_length=1, max_length=256)
    visible_columns: list[ColumnName] = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def valid_columns(self):
        self.column_order = list(dict.fromkeys(self.column_order))
        self.visible_columns = list(dict.fromkeys(self.visible_columns))
        if not set(self.visible_columns).issubset(self.column_order):
            raise ValueError("Sichtbare Spalten müssen in der Spaltenreihenfolge enthalten sein.")
        return self


def create_preferences_router(get_web_session):
    router = APIRouter(prefix="/api/preferences", tags=["preferences"])

    def check_account(session, expected_email):
        if expected_email and expected_email.strip().casefold() != session.email.strip().casefold():
            raise HTTPException(409, "Die Anmeldung hat sich geändert. Bitte die Seite neu laden.")

    def auth_error(error):
        code = 401 if str(getattr(error, "status", "")) in {"401", "403"} else 503
        return HTTPException(code, "Die persönlichen Spalteneinstellungen konnten nicht gespeichert oder geladen werden.")

    @router.get("/inventory-columns")
    def load_columns(response: Response, web_session=Depends(get_web_session),
                     expected_email: str | None = Header(default=None, alias="X-ITAssetFlow-User")) -> dict[str, Any]:
        check_account(web_session, expected_email)
        response.headers["Cache-Control"] = "no-store"
        try:
            user = web_session.client.auth.get_user().user
        except Exception as error:
            raise auth_error(error) from error
        if user is None:
            raise HTTPException(401, "Nicht angemeldet.")
        raw = (user.user_metadata or {}).get(PREFERENCE_KEY)
        try:
            preferences = InventoryColumns.model_validate(raw).model_dump() if raw is not None else None
        except ValidationError:
            preferences = None
        return {"preferences": preferences}

    @router.put("/inventory-columns")
    def save_columns(payload: InventoryColumns, response: Response, web_session=Depends(get_web_session),
                     expected_email: str = Header(alias="X-ITAssetFlow-User")) -> dict[str, Any]:
        check_account(web_session, expected_email)
        preferences = payload.model_dump()
        try:
            # Auth aktualisiert ausschliesslich das Profil der aktuellen Sitzung.
            # Diese Darstellungsdaten werden nie für Berechtigungen verwendet.
            result = web_session.client.auth.update_user({"data": {PREFERENCE_KEY: preferences}})
        except Exception as error:
            raise auth_error(error) from error
        if result.user is None:
            raise HTTPException(503, "Die Spalteneinstellungen konnten nicht bestätigt werden.")
        response.headers["Cache-Control"] = "no-store"
        return {"preferences": preferences}

    return router
