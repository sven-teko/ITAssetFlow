"""QR-Kennungen und Lagerbuchungen über die vorhandenen Inventartabellen."""
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import uuid4

from supabase import Client


def normalize_qr_code(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("Der QR-Code muss Text enthalten.")
    code = value.strip()
    if not code or len(code) > 100 or re.search(r"[\x00-\x1f\x7f]", code):
        raise ValueError("Bitte eine Artikelkennung mit 1 bis 100 Zeichen ohne Zeilenumbrüche scannen.")
    return code


class QrService:
    def __init__(self, client: Client, *, actor_email: str = "") -> None:
        self.client = client
        self.actor_email = actor_email

    @staticmethod
    def _data(response: Any) -> list[dict[str, Any]]:
        return [row for row in (getattr(response, "data", None) or []) if isinstance(row, dict)]

    def _all(self, table: str, columns: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        while True:
            page = self._data(self.client.table(table).select(columns).order("id").range(len(rows), len(rows) + 499).execute())
            rows.extend(page)
            if len(page) < 500:
                return rows

    def _models_for_code(self, code: str) -> list[dict[str, Any]]:
        # ilike benötigt maskierte Platzhalter; zusätzlich exakt vergleichen.
        escaped = code.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_").replace("*", r"\*")
        found = {}
        for field in ("sku", "part_number"):
            response = self.client.table("product_models").select("id,name,sku,part_number,tracking_mode,is_active").ilike(field, escaped).limit(100).execute()
            for row in self._data(response):
                if str(row.get(field) or "").strip().casefold() == code.casefold():
                    found[row["id"]] = row
        return list(found.values())

    def _assets_for_code(self, code: str) -> list[dict[str, Any]]:
        found = {}
        for field in ("asset_tag", "serial_number"):
            response = self.client.table("assets").select("id,asset_tag,serial_number,product_model_id,condition,status").eq(field, code).execute()
            for row in self._data(response):
                found[row["id"]] = row
        return list(found.values())

    def lookup(self, value: Any) -> dict[str, Any]:
        code = normalize_qr_code(value)
        assets = self._assets_for_code(code)
        matched_models = self._models_for_code(code)
        model_ids = set(row["product_model_id"] for row in assets) | set(row["id"] for row in matched_models)
        models = {}
        if model_ids:
            response = self.client.table("product_models").select("id,name,sku,tracking_mode,is_active").in_("id", list(model_ids)).execute()
            models = {row["id"]: row for row in self._data(response)}

        sites = {row["id"]: row for row in self._all("sites", "id,name")}
        departments = {row["id"]: row for row in self._all("departments", "id,name,site_id")}
        locations = self._all("storage_locations", "id,name,site_id,department_id,is_active")
        location_by_id = {row["id"]: row for row in locations}

        def context(location_id: Any) -> dict[str, Any]:
            location = location_by_id.get(location_id, {})
            return {
                "storage_location_id": location_id,
                "storage_location_name": location.get("name") or "Nicht zugeordnet",
                "site_name": sites.get(location.get("site_id"), {}).get("name") or "",
                "department_name": departments.get(location.get("department_id"), {}).get("name") or "",
            }

        matches = []
        for asset in assets:
            response = self.client.table("asset_locations").select("storage_location_id").eq("asset_id", asset["id"]).is_("valid_to", "null").order("valid_from", desc=True).limit(1).execute()
            current = self._data(response)
            model = models.get(asset["product_model_id"], {})
            matches.append({**asset, **context(current[0]["storage_location_id"] if current else None),
                "key": f"asset:{asset['id']}", "record_type": "asset", "quantity": 1,
                "product_model_name": model.get("name") or asset["asset_tag"]})

        for model in matched_models:
            if model.get("tracking_mode") not in {"quantity", "hybrid"} or model.get("is_active") is False:
                continue
            response = self.client.table("stock_levels").select("storage_location_id,condition,quantity").eq("product_model_id", model["id"]).execute()
            levels = self._data(response)
            usable = [row for row in levels if location_by_id.get(row["storage_location_id"], {}).get("is_active") is True]
            for level in usable or [{"storage_location_id": None, "condition": "used", "quantity": 0}]:
                matches.append({**context(level["storage_location_id"]),
                    "key": f"stock:{model['id']}:{level['storage_location_id']}:{level['condition']}",
                    "record_type": "stock", "product_model_id": model["id"],
                    "product_model_name": model["name"], "condition": level["condition"],
                    "quantity": float(level["quantity"] or 0)})

        active_locations = [{**context(row["id"]), "id": row["id"]} for row in locations if row.get("is_active") is True and row.get("department_id") is not None]
        return {"code": code, "matches": matches, "locations": active_locations}

    def bind_model_code(self, model_id: Any, value: Any) -> None:
        code = normalize_qr_code(value)
        if self._assets_for_code(code):
            raise ValueError("Dieser QR-Code gehört bereits zu einem Einzelgerät.")
        if any(str(row["id"]) != str(model_id) for row in self._models_for_code(code)):
            raise ValueError("Dieser QR-Code gehört bereits zu einem anderen Produktmodell.")
        rows = self._data(self.client.table("product_models").select("id,sku").eq("id", model_id).limit(1).execute())
        if not rows:
            raise ValueError("Das Produktmodell existiert nicht mehr.")
        previous = rows[0].get("sku")
        if str(previous or "").strip().casefold() == code.casefold():
            return
        if str(previous or "").strip():
            raise ValueError("Dieses Produktmodell hat bereits eine andere Artikelkennung (SKU). Bitte dessen QR-Code verwenden oder ein neues Produktmodell anlegen.")
        query = self.client.table("product_models").update({"sku": code}).eq("id", model_id)
        query = query.is_("sku", "null") if previous is None else query.eq("sku", previous)
        if not self._data(query.execute()):
            raise ValueError("Die Artikelkennung wurde gleichzeitig geändert. Bitte den QR-Code erneut prüfen.")

    def adjust(self, payload: dict[str, Any]) -> dict[str, Any]:
        code = normalize_qr_code(payload.get("code"))
        try:
            quantity = Decimal(str(payload.get("quantity")))
            if not quantity.is_finite() or quantity <= 0 or quantity != quantity.to_integral_value() or quantity > 1_000_000:
                raise ValueError
            model_id = int(str(payload.get("product_model_id")))
            location_id = int(str(payload.get("storage_location_id")))
        except (ValueError, TypeError, InvalidOperation) as error:
            raise ValueError("Bitte Artikel, Lagerort und eine ganze Menge zwischen 1 und 1’000’000 angeben.") from error
        direction = payload.get("direction")
        condition = str(payload.get("condition") or "").strip()
        if direction not in {"add", "remove"} or condition not in {"new", "like_new", "used", "worn", "defective"}:
            raise ValueError("Ungültige Buchungsart oder ungültiger Zustand.")
        models = self._models_for_code(code)
        if not any(row["id"] == model_id and row.get("tracking_mode") in {"quantity", "hybrid"} and row.get("is_active") is not False for row in models):
            raise ValueError("QR-Code und Mengenartikel stimmen nicht überein. Bitte erneut scannen.")
        locations = self._data(self.client.table("storage_locations").select("id,department_id,is_active").eq("id", location_id).limit(1).execute())
        if not locations or not locations[0].get("is_active") or locations[0].get("department_id") is None:
            raise ValueError("Bitte einen aktiven Lagerort mit Abteilung auswählen.")

        def balance() -> Decimal:
            rows = self._data(self.client.table("stock_levels").select("quantity").eq("product_model_id", model_id).eq("storage_location_id", location_id).eq("condition", condition).limit(1).execute())
            return Decimal(str(rows[0]["quantity"] or 0)) if rows else Decimal(0)

        if direction == "remove" and balance() < quantity:
            raise ValueError("Nicht genügend Lagerbestand für diesen Abgang. Bitte den aktuellen Bestand prüfen.")
        employees = self._data(self.client.table("employees").select("id").eq("email", self.actor_email).eq("is_active", True).limit(1).execute())
        if not employees:
            raise ValueError("Der angemeldete Benutzer konnte keinem aktiven Mitarbeiter zugeordnet werden.")
        incoming = direction == "add"
        history = self._data(self.client.table("stock_movements").select("purchase_date,new_price,status").eq("product_model_id", model_id).eq("to_storage_location_id", location_id).eq("to_condition", condition).order("id", desc=True).limit(1).execute())
        metadata = history[0] if history else {}
        movement = {
            "product_model_id": model_id,
            "from_storage_location_id": None if incoming else location_id,
            "to_storage_location_id": location_id if incoming else None,
            "from_condition": None if incoming else condition,
            "to_condition": condition if incoming else None,
            "quantity": float(quantity), "movement_type": "receipt" if incoming else "issue",
            "department_id": locations[0]["department_id"], "performed_by_employee_id": employees[0]["id"],
            "purchase_date": metadata.get("purchase_date") or date.today().isoformat(),
            "new_price": metadata.get("new_price") or 0, "status": metadata.get("status") or "available",
            "reference": f"QR:{uuid4()}", "note": f"QR-{'Zugang' if incoming else 'Abgang'}: {code}",
        }
        # Eine einzige INSERT-Buchung. Der vorhandene DB-Trigger
        # prevent_negative_stock serialisiert konkurrierende Bestandsänderungen.
        response = self.client.table("stock_movements").insert(movement).execute()
        rows = self._data(response)
        try:
            current_quantity = float(balance())
        except Exception:
            # Die Buchung ist bereits gespeichert. Ein fehlgeschlagener
            # anschliessender Lesezugriff darf keinen erneuten Zugang auslösen.
            current_quantity = None
        return {"saved": True, "movement_id": rows[0].get("id") if rows else None,
            "quantity": current_quantity, "direction": direction, "changed_quantity": float(quantity)}
