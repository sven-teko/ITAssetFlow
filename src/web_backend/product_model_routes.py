from __future__ import annotations

import json
import logging
import math
import re
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from supabase import Client

from inventory import (
    fallback_specification_label,
    get_specification_fields,
    normalize_specification_key,
    normalize_specifications,
)


MODEL_COLUMNS = (
    "id,manufacturer_id,category_id,name,part_number,sku,"
    "specifications,tracking_mode,unit_code,is_active"
)
EDITABLE_COLUMNS = {
    "name", "manufacturer_id", "part_number", "sku", "is_active", "specifications",
}
CREATE_COLUMNS = (EDITABLE_COLUMNS - {"is_active"}) | {"category_id", "tracking_mode", "unit_code"}
LOGGER = logging.getLogger(__name__)

SPECIFICATION_ALIASES = {
    "kapazitaet_gb": "capacity_gb",
    "kapazitaet_tb": "capacity_tb",
    "schnittstelle": "interface",
    "bauform": "form_factor",
    "laufwerkstyp": "drive_type",
    "speichertyp": "memory_type",
    "komponentenart": "component_type",
    "component_type": "component_type",
}


def field_token(value: str) -> str:
    value = value.strip().casefold().translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}))
    return re.sub(r"[^a-z0-9]+", "_", value).strip("_")


def specification_key(value: str) -> str:
    key = normalize_specification_key(value)
    return SPECIFICATION_ALIASES.get(field_token(key), key)


def field_aliases(fields: list[dict[str, str]], stored: Any = None) -> dict[str, str]:
    candidates: dict[str, set[str]] = {}
    for field in fields:
        label = f"{field['label']} {field.get('unit', '')}".strip()
        for name in (field["key"], label):
            candidates.setdefault(field_token(name), set()).add(field["key"])
    aliases = {name: next(iter(keys)) for name, keys in candidates.items() if len(keys) == 1}
    type_keys = [field["key"] for field in fields if field["key"].endswith("_type") and field["key"] != "component_type"]
    if len(type_keys) == 1 and not any(field["key"] == "typ" for field in fields):
        aliases["typ"] = type_keys[0]
    fields_by_key = {field["key"]: field for field in fields}
    for key, value in normalize_specifications(stored).items():
        token = field_token(key)
        target = aliases.get(token)
        if target and key != target and value is not None and value != "":
            expected = fields_by_key[target]["type"]
            actual = specification_type(value)
            if actual != expected and {actual, expected} != {"number", "integer"}:
                # Gleichnamige Metadaten mit anderem Datentyp bleiben eigenständige Angaben.
                aliases.pop(token)
    return aliases


def resolved_key(value: str, aliases: dict[str, str]) -> str:
    key = specification_key(value)
    return aliases.get(field_token(key), key)


def specification_values(stored: Any, fields: list[dict[str, str]]) -> dict[str, Any]:
    aliases = field_aliases(fields, stored)
    values: dict[str, Any] = {}
    priorities: dict[str, tuple[bool, bool]] = {}
    for key, value in normalize_specifications(stored).items():
        target = resolved_key(key, aliases)
        populated = value is not None and (not isinstance(value, str) or bool(value.strip()))
        priority = (populated, key != target)
        # Gefüllte Metadaten haben Vorrang vor leeren oder parallel angelegten Formularwerten.
        if target not in values or priority > priorities[target]:
            values[target], priorities[target] = value, priority
    return values


def specification_type(value: Any) -> str:
    return (
        "boolean" if isinstance(value, bool)
        else "number" if isinstance(value, (int, float))
        else "json" if isinstance(value, (dict, list))
        else "text"
    )


def model_fields(schema: Any) -> list[dict[str, str]]:
    fields: dict[str, dict[str, str]] = {}
    for field in get_specification_fields(schema):
        key = specification_key(field["key"])
        if not key or key == "component_type" or str(field.get("scope") or "model").strip().casefold() == "asset":
            continue
        field_type = str(field.get("type") or "text").strip().casefold()
        fields[key] = {
            "key": key,
            "label": str(field.get("label") or field["key"]).strip(),
            "unit": str(field.get("unit") or "").strip(),
            "type": field_type if field_type in {"text", "integer", "number", "boolean"} else "text",
        }
    return list(fields.values())


def public_model(row: dict[str, Any], fields: list[dict[str, str]]) -> dict[str, Any]:
    values = specification_values(row.get("specifications"), fields)
    complete_fields = {field["key"]: field for field in fields}
    for key, value in values.items():
        if key not in complete_fields and key != "component_type":
            label = {"capacity_tb": "Kapazität [TB]"}.get(key, fallback_specification_label(key))
            match = re.fullmatch(r"(.+?)\s*\[([^\]]+)\]", label)
            complete_fields[key] = {
                "key": key, "label": match[1] if match else label,
                "unit": match[2] if match else "", "type": specification_type(value),
            }
    return {**row, "specifications": values, "specification_fields": list(complete_fields.values())}


class ProductModelService:
    def __init__(self, client: Client) -> None:
        self.client = client

    def _load_rows(self, table: str, columns: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        while True:
            page = (
                self.client.table(table).select(columns).order("name").order("id")
                .range(len(rows), len(rows) + 999).execute().data
            )
            if not page:
                return rows
            rows.extend(page)

    def _get_row(self, table: str, row_id: Any, columns: str) -> dict[str, Any] | None:
        rows = self.client.table(table).select(columns).eq("id", row_id).limit(1).execute().data
        return rows[0] if rows else None

    def load(self) -> dict[str, Any]:
        categories = self._load_rows("product_categories", "id,name,specification_schema")
        fields_by_category = {str(row["id"]): model_fields(row.get("specification_schema")) for row in categories}
        return {
            "product_models": [public_model(row, fields_by_category.get(str(row["category_id"]), [])) for row in self._load_rows("product_models", MODEL_COLUMNS)],
            "product_categories": [
                {"id": row["id"], "name": row["name"], "fields": fields_by_category[str(row["id"])]}
                for row in categories
            ],
            "manufacturers": self._load_rows("manufacturers", "id,name"),
        }

    def _editable_values(self, changes: dict[str, Any]) -> dict[str, Any]:
        row: dict[str, Any] = {}
        for key in ("name", "part_number", "sku"):
            if key not in changes:
                continue
            value = changes[key]
            if value is not None and not isinstance(value, str):
                raise ValueError("Modellbezeichnung, Artikelnummer und SKU müssen Text enthalten.")
            row[key] = value.strip() if isinstance(value, str) else None
            if key == "name" and not row[key]:
                raise ValueError("Die Modellbezeichnung darf nicht leer sein.")
            row[key] = row[key] or None

        if "manufacturer_id" in changes:
            manufacturer_id = changes["manufacturer_id"]
            if (
                isinstance(manufacturer_id, bool)
                or not isinstance(manufacturer_id, (str, int))
                or not str(manufacturer_id).strip()
                or self._get_row("manufacturers", manufacturer_id, "id") is None
            ):
                raise ValueError("Bitte einen vorhandenen Hersteller auswählen.")
            row["manufacturer_id"] = manufacturer_id

        if "is_active" in changes:
            if not isinstance(changes["is_active"], bool):
                raise ValueError("Der Modellstatus muss aktiv oder inaktiv sein.")
            row["is_active"] = changes["is_active"]
        return row

    def create(self, values: dict[str, Any]) -> dict[str, Any]:
        if set(values) - CREATE_COLUMNS:
            raise ValueError("Es wurden nicht bearbeitbare Modellfelder übergeben.")
        row = self._editable_values(values)
        if not row.get("name") or not row.get("manufacturer_id"):
            raise ValueError("Bitte eine Modellbezeichnung und einen Hersteller angeben.")
        category_id = values.get("category_id")
        if isinstance(category_id, bool) or not isinstance(category_id, (str, int)) or not str(category_id).strip():
            raise ValueError("Bitte eine vorhandene Produktkategorie auswählen.")
        category = self._get_row("product_categories", category_id, "id,specification_schema")
        if category is None:
            raise ValueError("Bitte eine vorhandene Produktkategorie auswählen.")
        tracking_mode = values.get("tracking_mode", "serialized")
        unit_code = values.get("unit_code", "piece")
        if tracking_mode not in ("serialized", "quantity"):
            raise ValueError("Bitte Einzelartikel oder Mengenbestand auswählen.")
        if unit_code not in ("piece", "meter", "pack", "box"):
            raise ValueError("Bitte eine gültige Einheit auswählen.")
        fields = model_fields(category.get("specification_schema"))
        row.update({
            "category_id": category["id"], "tracking_mode": tracking_mode,
            "unit_code": unit_code, "is_active": True,
            "specifications": self._merge_specifications({}, values.get("specifications", {}), fields),
        })
        rows = self.client.table("product_models").insert(row).execute().data
        if not rows or rows[0].get("id") is None:
            raise HTTPException(500, "Keine vollständige Speicherbestätigung erhalten. Bitte die Seite neu laden und die Modellliste prüfen.")
        return public_model(rows[0], fields)

    def update(self, model_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        if set(changes) - EDITABLE_COLUMNS:
            raise ValueError("Es wurden nicht bearbeitbare Modellfelder übergeben.")
        current = self._get_row("product_models", model_id, MODEL_COLUMNS)
        if current is None:
            raise HTTPException(404, "Das Produktmodell existiert nicht mehr oder ist nicht zugänglich.")
        row = self._editable_values(changes)

        category = self._get_row("product_categories", current["category_id"], "specification_schema")
        fields = model_fields(category.get("specification_schema")) if category else []
        if "specifications" in changes:
            if category is None:
                raise ValueError("Die Produktkategorie konnte nicht geladen werden.")
            row["specifications"] = self._merge_specifications(current.get("specifications"), changes["specifications"], fields)

        if not row:
            return public_model(current, fields)
        rows = self.client.table("product_models").update(row).eq("id", current["id"]).execute().data
        if not rows:
            raise HTTPException(403, "Das Modell wurde nicht gespeichert. Bitte die Schreibrechte prüfen und die Liste neu laden.")
        return public_model(rows[0], fields)

    def delete(self, model_id: str) -> dict[str, Any]:
        current = self._get_row("product_models", model_id, "id")
        if current is None:
            raise HTTPException(404, "Das Produktmodell existiert nicht mehr oder ist nicht zugänglich.")
        # Verwendete Modelle und ihre Lagerhistorie bleiben erhalten.
        for table in ("assets", "stock_movements", "stock_levels"):
            references = (
                self.client.table(table).select("product_model_id")
                .eq("product_model_id", current["id"]).limit(1).execute().data
            )
            if references:
                raise HTTPException(409, "Dieses Produktmodell wird im Inventar oder in der Lagerhistorie verwendet und kann nicht gelöscht werden.")
        try:
            rows = self.client.table("product_models").delete().eq("id", current["id"]).execute().data
        except Exception as error:
            if str(getattr(error, "code", "")) == "23503":
                raise HTTPException(409, "Dieses Produktmodell ist noch mit anderen Daten verknüpft und kann nicht gelöscht werden.") from error
            raise
        if not rows:
            raise HTTPException(403, "Das Modell wurde nicht gelöscht. Bitte die Löschrechte prüfen und die Seite neu laden.")
        return {"id": current["id"]}

    @staticmethod
    def _merge_specifications(stored: Any, changes: Any, fields: list[dict[str, str]]) -> dict[str, Any]:
        if not isinstance(changes, dict):
            raise ValueError("Die Spezifikationen müssen als Felder übergeben werden.")
        if stored is not None and not isinstance(stored, dict):
            raise ValueError("Die gespeicherten Spezifikationen haben ein ungültiges Format und können nicht überschrieben werden.")
        result = dict(stored or {})
        aliases = field_aliases(fields, stored)
        stored_values = specification_values(stored, fields)
        fields_by_key = {field["key"]: field for field in fields}
        edited_keys: set[str] = set()
        for requested_key, value in changes.items():
            key = resolved_key(requested_key, aliases)
            if key == "component_type":
                raise ValueError("Die Komponentenart wird durch die Produktkategorie bestimmt und ist hier nicht bearbeitbar.")
            if key in edited_keys:
                raise ValueError("Ein Spezifikationsfeld wurde mehrfach übergeben. Bitte die Seite neu laden.")
            edited_keys.add(key)
            field = fields_by_key.get(key)
            if field is None:
                if key not in stored_values:
                    raise ValueError("Die Spezifikationsfelder wurden geändert. Bitte die Seite neu laden.")
                # Vorhandene Zusatzfelder bleiben auch ohne Kategorieschema bearbeitbar.
                field_type = specification_type(stored_values[key])
                field = {"key": key, "label": key.replace("_", " "), "type": field_type}
            field_type = field["type"]
            if isinstance(value, str):
                value = value.strip() or None
            valid = value is None or (
                (field_type == "text" and isinstance(value, str))
                or (field_type == "boolean" and isinstance(value, bool))
                or (field_type == "json" and type(value) is type(stored_values.get(key)))
                or (
                    field_type in {"integer", "number"}
                    and isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(value)
                    and (field_type != "integer" or value == int(value))
                )
            )
            if not valid:
                raise ValueError(f"Ungültiger Wert für {field['label']}.")
            if field_type == "json" and value is not None:
                try:
                    json.dumps(value, allow_nan=False)
                except (ValueError, TypeError, OverflowError) as error:
                    raise ValueError(f"Ungültiger Wert für {field['label']}.") from error

            # Nur geänderte Felder ersetzen; unbekannte Angaben und unberührte Altwerte bleiben erhalten.
            for stored_key in list(result):
                if resolved_key(stored_key, aliases) == key:
                    del result[stored_key]
            if value is not None:
                result[key] = value
        return result


def database_error(error: Exception) -> HTTPException:
    code = str(getattr(error, "code", ""))
    if code == "42501":
        return HTTPException(403, "Die Datenbank erlaubt diesem Benutzer das Bearbeiten der Produktmodelle nicht.")
    if code == "23505":
        return HTTPException(409, "Ein Produktmodell mit diesen eindeutigen Angaben ist bereits vorhanden.")
    if code == "23503":
        return HTTPException(409, "Zugehörige Stammdaten wurden geändert. Bitte die Seite neu laden.")
    LOGGER.exception("Produktmodell-Verwaltung: Datenbankzugriff fehlgeschlagen")
    return HTTPException(500, "Die Produktmodelle konnten nicht verarbeitet werden. Bitte erneut versuchen.")


def create_product_models_router(
    require_admin_session: Callable[..., Any],
    publish_inventory_change: Callable[[str | None], None],
) -> APIRouter:
    router = APIRouter(prefix="/api/product-models", tags=["product-models"])

    def notify_change(request: Request) -> None:
        source = request.headers.get("X-ITAssetFlow-Client-ID", "").strip()[:128]
        publish_inventory_change(source or None)

    @router.get("")
    def load_product_models(web_session: Any = Depends(require_admin_session)) -> dict[str, Any]:
        try:
            return ProductModelService(web_session.client).load()
        except HTTPException:
            raise
        except Exception as error:
            raise database_error(error) from error

    @router.put("/{model_id}")
    def update_product_model(
        model_id: str,
        changes: dict[str, Any],
        request: Request,
        web_session: Any = Depends(require_admin_session),
    ) -> dict[str, Any]:
        try:
            result = ProductModelService(web_session.client).update(model_id, changes)
        except HTTPException:
            raise
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except Exception as error:
            raise database_error(error) from error
        if changes:
            notify_change(request)
        return result

    @router.post("", status_code=201)
    def create_product_model(
        values: dict[str, Any], request: Request,
        web_session: Any = Depends(require_admin_session),
    ) -> dict[str, Any]:
        try:
            result = ProductModelService(web_session.client).create(values)
        except HTTPException:
            raise
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except Exception as error:
            raise database_error(error) from error
        notify_change(request)
        return result

    @router.delete("/{model_id}")
    def delete_product_model(
        model_id: str, request: Request,
        web_session: Any = Depends(require_admin_session),
    ) -> dict[str, Any]:
        try:
            result = ProductModelService(web_session.client).delete(model_id)
        except HTTPException:
            raise
        except Exception as error:
            raise database_error(error) from error
        notify_change(request)
        return result

    return router
