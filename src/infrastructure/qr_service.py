"""QR-Kennungen und Lagerbuchungen über die vorhandenen Inventartabellen."""
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from supabase import Client
from infrastructure.scanner_codes import normalize_ean, normalize_upc, code_values, normalize_mac
from infrastructure.scanner_schema import missing_scanner_column, select_scanner_compatible, write_scanner_compatible


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

    def _models_for_code(self, code: str, *, retail_type: str | None = None) -> list[dict[str, Any]]:
        # ilike benötigt maskierte Platzhalter; zusätzlich exakt vergleichen.
        escaped = code.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_").replace("*", r"\*")
        found = {}
        filters = {} if retail_type else dict.fromkeys(("qr_code", "ean", "upc", "sku", "part_number"), code)
        if retail_type == "upc" or (not retail_type and len(code) == 12 and code.isascii() and code.isdigit()):
            filters.update(upc=code, ean="0" + code)
        elif retail_type == "ean" or (not retail_type and len(code) == 13 and code.startswith("0")):
            filters["ean"] = code
            if len(code) == 13 and code.startswith("0"):
                filters["upc"] = code[1:]
        for field, value in filters.items():
            def query(columns: str):
                result = self.client.table("product_models").select(columns)
                result = result.eq(field, value) if field in {"qr_code", "ean", "upc"} else result.ilike(field, escaped)
                return result.limit(100)
            try:
                response = select_scanner_compatible(query, "product_models", "id,name,sku,part_number,qr_code,ean,upc,tracking_mode,is_active")
            except Exception as error:
                if missing_scanner_column(error, "product_models") == field:
                    continue
                raise
            for row in self._data(response):
                if str(row.get(field) or "").strip().casefold() == value.casefold():
                    found[row["id"]] = row
        return list(found.values())

    def _assets_for_code(self, code: str, *, ean_only: bool = False) -> list[dict[str, Any]]:
        found = {}
        try:
            mac = normalize_mac(code)
        except ValueError:
            mac = None
        if mac:
            compact = mac.replace(":", "")
            mac_variants = (mac, mac.replace(":", "-"), compact, ".".join(compact[i:i+4] for i in range(0, 12, 4)))
        else:
            mac_variants = ()

        for field in (("ean",) if ean_only else ("qr_code", "ean", "asset_tag", "serial_number", "mac_address")):
            if field == "mac_address" and not mac_variants:
                continue

            def query(columns: str):
                request = self.client.table("assets").select(columns).is_("archived_at", "null")
                if mac_variants and field in {"asset_tag", "mac_address"}:
                    # All patterns are validated hex and fixed punctuation, so ILIKE is exact apart from case.
                    filters = [f"{field}.ilike.{variant}" for variant in mac_variants]
                    if field == "asset_tag" and code.casefold() not in {variant.casefold() for variant in mac_variants}:
                        # A tag may contain a literal prefix such as "MAC: ".
                        filters.append(f'{field}.eq."{code}"')
                    return request.or_(",".join(filters))
                return request.eq(field, code)

            try:
                response = select_scanner_compatible(
                    query, "assets", "id,asset_tag,serial_number,mac_address,qr_code,ean,product_model_id,condition,status",
                )
            except Exception as error:
                if missing_scanner_column(error, "assets") == field:
                    continue
                raise
            for row in self._data(response):
                previous = found.get(row["id"], {}).get("matched_identifier")
                if field == "mac_address" or (field == "asset_tag" and mac_variants):
                    row["matched_identifier"] = "mac"
                elif field == "serial_number" and previous != "mac":
                    row["matched_identifier"] = "serial"
                elif previous:
                    row["matched_identifier"] = previous
                found[row["id"]] = row
        return list(found.values())

    def lookup(self, value: Any, code_type: str = "auto") -> dict[str, Any]:
        code = normalize_qr_code(value)
        if code_type not in {"auto", "qr", "ean", "upc", "mac", "serial"}:
            raise ValueError("Unbekannte Codeart.")
        if code_type == "ean":
            normalize_ean(code)
        elif code_type == "upc":
            normalize_upc(code)
        retail_code = code_type in {"ean", "upc"}
        ean = "0" + code if code_type == "upc" else code
        assets = self._assets_for_code(ean, ean_only=retail_code)
        direct_asset_ids = {row["id"] for row in assets}
        matched = {row["id"]: row for row in self._models_for_code(code, retail_type=code_type if retail_code else None)}
        models = matched.copy()
        other_ids = {row["product_model_id"] for row in assets}.difference(models)
        if other_ids:
            response = select_scanner_compatible(
                lambda columns: self.client.table("product_models").select(columns).in_("id", list(other_ids)),
                "product_models", "id,name,sku,tracking_mode,is_active,ean",
            )
            models.update((row["id"], row) for row in self._data(response))
        if retail_code:
            # A corrected model EAN takes precedence over copies left on older devices.
            assets = [row for row in assets if row["product_model_id"] in matched
                      or models.get(row["product_model_id"], {}).get("ean") in {None, "", ean}]
            # An old EAN on one device still identifies the model when it
            # has no newer EAN. Expand to its other visible, active devices.
            for row in assets:
                model = models.get(row["product_model_id"])
                if model and model.get("is_active") is not False:
                    matched.setdefault(model["id"], model)
        matched_models = list(matched.values())
        seen_assets = {row["id"] for row in assets}
        for model in matched_models:
            if model.get("tracking_mode") not in {"serialized", "hybrid"}:
                continue
            offset = 0
            while True:
                response = select_scanner_compatible(
                    lambda columns: self.client.table("assets").select(columns).eq("product_model_id", model["id"])
                    .is_("archived_at", "null").order("id").range(offset, offset + 499),
                    "assets", "id,asset_tag,serial_number,mac_address,qr_code,ean,product_model_id,condition,status",
                )
                page = self._data(response)
                for asset in page:
                    if asset["id"] not in seen_assets:
                        assets.append(asset)
                        seen_assets.add(asset["id"])
                if len(page) < 500:
                    break
                offset += len(page)
        direct_asset_match = any(row["id"] in direct_asset_ids for row in assets)

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
        detected = next((row.get("matched_identifier") for row in assets if row.get("matched_identifier")), code_type)
        stocked = [row for row in matches if row["record_type"] == "stock" and row["quantity"] > 0]
        preferred = stocked[0]["key"] if not direct_asset_match and len(stocked) == 1 else None
        return {"code": code, "code_type": detected, "matches": matches, "locations": active_locations,
                "preferred_key": preferred,
                "direct_asset_keys": [f"asset:{row['id']}" for row in assets if row["id"] in direct_asset_ids],
                "models": [{key: model.get(key) for key in ("id", "name", "tracking_mode")}
                           for model in matched_models if model.get("is_active") is not False]}

    def save_model_codes(self, model_id: Any, values: dict[str, Any], *, only_empty: bool = False) -> None:
        changes = code_values(values)
        if not changes:
            return
        rows = self._data(select_scanner_compatible(
            lambda columns: self.client.table("product_models").select(columns).eq("id", model_id).limit(1),
            "product_models", "id,qr_code,ean,upc",
        ))
        if not rows:
            raise ValueError("Das Produktmodell existiert nicht mehr.")
        current = rows[0]
        changes = {key: value for key, value in changes.items() if value != current.get(key)}
        if only_empty and any(current.get(key) for key in changes):
            raise ValueError("Dieses Modell hat bereits einen anderen Code. Bitte die Kennungen unter Produktmodelle bearbeiten.")
        if not changes:
            return
        def query(values: dict[str, Any]):
            result = self.client.table("product_models").update(values).eq("id", model_id)
            for key in values:
                result = result.is_(key, "null") if current.get(key) is None else result.eq(key, current[key])
            return result
        if not self._data(write_scanner_compatible(query, "product_models", changes)):
            raise ValueError("Die Kennungen wurden gleichzeitig geändert. Bitte die Seite neu laden.")

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
            raise ValueError("Code und Mengenartikel stimmen nicht überein. Bitte erneut scannen.")
        locations = self._data(self.client.table("storage_locations").select("id,department_id,is_active").eq("id", location_id).limit(1).execute())
        if not locations or not locations[0].get("is_active") or locations[0].get("department_id") is None:
            raise ValueError("Bitte einen aktiven Lagerort mit Abteilung auswählen.")

        from infrastructure.stock_booking import book_stock
        return book_stock(self.client, payload)
