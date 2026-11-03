"""Nachvollziehbare und gemeinsam gespeicherte Zu- und Abgänge."""
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from infrastructure.date_validation import normalize_inventory_dates
from infrastructure.scanner_codes import normalize_mac
from infrastructure.archive_reason import ArchiveReason


def book_stock(client, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        request_id = str(UUID(str(payload.get("request_id"))))
        quantity = Decimal(str(payload.get("quantity")))
        if not quantity.is_finite() or not 0 < quantity <= 1_000_000 or quantity != quantity.to_integral_value():
            raise ValueError
        model_id, location_id = int(str(payload["product_model_id"])), int(str(payload["storage_location_id"]))
    except (ValueError, TypeError, KeyError, InvalidOperation) as error:
        raise ValueError("Bitte eine gültige Buchungskennung, einen Artikel, Lagerort und eine ganze Menge angeben.") from error
    if payload.get("withdrawal") is not None and not isinstance(payload["withdrawal"], dict):
        raise ValueError("Ungültige Entnahmedaten.")
    details = dict(payload.get("withdrawal") or {})
    if payload.get("direction") == "remove":
        if details.get("action") == "archive":
            try:
                details["reason"] = ArchiveReason.model_validate(details.get("reason")).model_dump()
            except ValueError as error:
                raise ValueError("Bitte einen Archivgrund mit den erforderlichen Angaben eingeben.") from error
        elif details.get("action") == "assets":
            units = details.get("units")
            if not isinstance(units, list) or len(units) != quantity or len(units) > 100:
                raise ValueError("Bitte für jedes entnommene Stück einen Einzelartikel erfassen (höchstens 100).")
            for unit in units:
                if not isinstance(unit, dict) or not str(unit.get("asset_tag") or "").strip():
                    raise ValueError("Eine Produkterkennung ist für jeden Einzelartikel erforderlich.")
                unit["mac_address"] = normalize_mac(unit.get("mac_address"))
        else:
            raise ValueError("Für eine Entnahme bitte Archivierung oder Einzelartikel wählen.")
    result = client.rpc("book_inventory_stock", {
        "p_request_id": request_id, "p_model": model_id, "p_location": location_id,
        "p_condition": payload.get("condition"), "p_quantity": float(quantity), "p_direction": payload.get("direction"),
        "p_details": details, "p_expected_quantity": payload.get("expected_quantity"),
    }).execute().data
    if not isinstance(result, dict) or result.get("saved") is not True:
        raise RuntimeError("Die Buchung wurde nicht bestätigt. Bitte dieselbe Buchung erneut prüfen.")
    return result


def reduce_edited_stock(client, payload: dict[str, Any]) -> dict[str, Any]:
    payload = normalize_inventory_dates(payload)
    edit, stock, model = payload.get("edit"), payload.get("stock"), payload.get("model")
    if not all(isinstance(value,dict) for value in (edit,stock,model)):
        raise ValueError("Bearbeitungsinformationen, Mengenbestand oder Produktmodell fehlen.")
    if payload.get("withdrawal") is not None and not isinstance(payload["withdrawal"],dict):
        raise ValueError("Ungültige Entnahmedaten.")
    if (model.get("mode") != "existing" or str(model.get("id")) != str(edit.get("product_model_id"))
            or str(payload.get("storage_location_id")) != str(edit.get("storage_location_id"))
            or payload.get("condition") != edit.get("condition")):
        raise ValueError("Bitte zuerst die Entnahme am bisherigen Lagerort buchen und danach den Restbestand verschieben.")
    details = dict(payload.get("withdrawal") or {})
    details["metadata"] = {key: stock.get(key) for key in ("purchase_date", "new_price", "status", "note")}
    if payload.get("scanner_codes"):
        # Kennungen werden separat verwaltet; bei einer Entnahme bleibt ihre Zuordnung unverändert.
        current = client.table("product_models").select("qr_code,ean").eq("id", model["id"]).limit(1).execute().data or []
        if current and any(current[0].get(key) != value for key, value in payload["scanner_codes"].items()):
            raise ValueError("Bitte geänderte QR-/EAN-Kennungen zuerst speichern und danach die Menge entnehmen.")
    result = book_stock(client, {
        "request_id": details.pop("request_id", None), "product_model_id": edit["product_model_id"],
        "storage_location_id": edit["storage_location_id"], "condition": edit["condition"],
        "quantity": float(Decimal(str(edit["stock_quantity"]))-Decimal(str(stock["quantity"]))),
        "direction": "remove", "expected_quantity": edit["stock_quantity"], "withdrawal": details,
    })
    return {"entry_type": "stock", "product_model_id": edit["product_model_id"], **result}
