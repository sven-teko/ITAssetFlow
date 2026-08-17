from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from supabase import Client

from inventory import (
    get_asset_identifier,
    get_category_label,
    fallback_specification_label,
    get_specification_fields,
    get_specification_label,
    normalize_specification_key,
    normalize_specifications,
    specification_column_name,
    USAGE_STATE_LABELS,
)

logger = logging.getLogger(__name__)


class AssetRepository:
    """Lesender Supabase-Zugriff für die aktuelle Inventarstruktur.

    Kernidee: Die Tabellen werden separat geladen und in Python verknüpft.
    Dadurch hängt die Hauptansicht nicht von PostgREST-Embedding/Aliasnamen ab.
    Zusatzrelationen sind optional: Fehlt eine Tabelle oder SELECT-Policy,
    bleiben die Assets trotzdem sichtbar.
    """

    def __init__(
        self,
        client: Client,
        asset_table_name: str = "assets",
    ) -> None:
        self.client = client
        self.asset_table_name = asset_table_name
        self.catalog_warning: str | None = None

    # ------------------------------------------------------------------
    # Öffentliche API
    # ------------------------------------------------------------------

    def load_inventory(
        self,
    ) -> list[dict[str, Any]]:
        """Lädt Einzel-Assets und mengenverwaltete Lagerbestände gemeinsam.

        Beide Datensatzarten werden in dieselbe flache UI-Struktur gebracht.
        Technische Unterschiede bleiben über ``_record_type`` erhalten.
        """

        self.catalog_warning = None

        assets = self._load_rows(
            self.asset_table_name,
            order_column="id",
            required=True,
        )
        product_models = self._load_rows(
            "product_models",
            order_column="id",
            required=False,
        )
        product_categories = self._load_rows(
            "product_categories",
            order_column="name",
            required=False,
        )
        manufacturers = self._load_rows(
            "manufacturers",
            order_column="name",
            required=False,
        )
        storage_locations = self._load_rows(
            "storage_locations",
            order_column="id",
            required=False,
        )
        sites = self._load_rows(
            "sites",
            order_column="name",
            required=False,
            select_expression="id,name",
        )
        stock_levels = self._load_stock_levels()

        if not product_models:
            self._warn(
                "Keine Produktmodelle lesbar. Prüfe SELECT/RLS für product_models."
            )
        if not product_categories:
            self._warn(
                "Keine Produktkategorien lesbar. Prüfe SELECT/RLS für product_categories."
            )

        merged_assets = self._merge_catalog_data(
            assets,
            product_models,
            product_categories,
            manufacturers,
        )

        for asset in merged_assets:
            asset["_record_type"] = "asset"
            asset.setdefault("stock_quantity", None)

        self.enrich_current_context(
            merged_assets,
            storage_locations=storage_locations,
            sites=sites,
        )

        stock_rows = self._merge_stock_level_rows(
            stock_levels,
            product_models,
            product_categories,
            manufacturers,
            storage_locations,
            sites,
        )

        return merged_assets + stock_rows

    def delete_inventory_entries(
        self,
        entries: list[dict[str, Any]],
    ) -> dict[str, int]:
        """Löscht ausgewählte Inventareinträge.

        Einzelartikel werden inklusive ihrer direkten Zuordnungen gelöscht.
        Mengenbestand wird aus Gründen der Bestandsnachvollziehbarkeit nicht
        aus der Bewegungshistorie entfernt. Stattdessen wird der aktuell
        vorhandene Bestand per Korrekturbuchung vollständig ausgebucht.
        """

        if not isinstance(entries, list) or not entries:
            raise ValueError("Keine Inventareinträge zum Löschen ausgewählt.")

        normalized = [
            entry
            for entry in entries
            if isinstance(entry, dict)
        ]
        if not normalized:
            raise ValueError("Die ausgewählten Inventareinträge sind ungültig.")

        # Zuerst alle Datensätze prüfen, bevor die erste Schreiboperation läuft.
        for entry in normalized:
            record_type = str(
                entry.get("_record_type")
                or "asset"
            ).strip().casefold()

            if record_type == "stock":
                self._validate_stock_delete(entry)
            elif record_type == "asset":
                if entry.get("id") is None:
                    raise ValueError(
                        "Ein ausgewählter Einzelartikel besitzt keine ID."
                    )
            else:
                raise ValueError(
                    f"Unbekannter Inventartyp: {record_type or 'leer'}"
                )

        asset_count = 0
        stock_count = 0

        for entry in normalized:
            record_type = str(
                entry.get("_record_type")
                or "asset"
            ).strip().casefold()

            if record_type == "stock":
                if self._delete_stock_level(entry):
                    stock_count += 1
                continue

            self._delete_asset(entry.get("id"))
            asset_count += 1

        return {
            "deleted_count": asset_count + stock_count,
            "asset_count": asset_count,
            "stock_count": stock_count,
        }

    def load_create_form_data(self) -> dict[str, list[dict[str, Any]]]:
        """Lädt die Stammdaten für den Dialog ``Neuer Eintrag``.

        Die Datenmenge ist klein und wird bewusst separat vom eigentlichen
        Inventar geladen. Dadurch kann der Dialog auch Produktmodelle anbieten,
        die aktuell noch keinen Bestand besitzen.
        """

        product_categories = self._load_rows(
            "product_categories",
            order_column="name",
            required=True,
            select_expression=(
                "id,name,code,inventory_group,specification_schema"
            ),
        )
        manufacturers = self._load_rows(
            "manufacturers",
            order_column="name",
            required=True,
            select_expression="id,name",
        )
        product_models = self._load_rows(
            "product_models",
            order_column="name",
            required=True,
            select_expression=(
                "id,manufacturer_id,category_id,name,part_number,"
                "specifications,tracking_mode,is_active,sku,unit_code"
            ),
        )
        sites = self._load_rows(
            "sites",
            order_column="name",
            required=True,
            select_expression="id,name",
        )
        storage_locations = [
            row
            for row in self._load_rows(
                "storage_locations",
                order_column="name",
                required=True,
                select_expression=(
                    "id,site_id,department_id,name,parent_location_id,"
                    "location_type,code,is_active"
                ),
            )
            if bool(row.get("is_active", True))
        ]
        employees = self._load_rows(
            "employees",
            order_column="last_name",
            required=False,
            select_expression=(
                "id,employee_number,first_name,last_name,email,"
                "department_id,is_active"
            ),
        )
        departments = self._load_rows(
            "departments",
            order_column="name",
            required=False,
            select_expression="id,name,site_id",
        )
        assets = self._load_rows(
            self.asset_table_name,
            order_column="asset_tag",
            required=False,
            select_expression="id,asset_tag,serial_number,product_model_id,status",
        )

        models_by_id = self._index_by_id(product_models)
        parent_assets: list[dict[str, Any]] = []
        for asset in assets:
            if str(asset.get("status") or "").strip().casefold() == "retired":
                continue
            model = models_by_id.get(asset.get("product_model_id"))
            parts = [
                str(asset.get("asset_tag") or "").strip(),
                str(model.get("name") or "").strip() if isinstance(model, dict) else "",
                str(asset.get("serial_number") or "").strip(),
            ]
            label = " · ".join(part for part in parts if part)
            parent_assets.append(
                {
                    "id": asset.get("id"),
                    "label": label or f"Asset #{asset.get('id')}",
                }
            )

        return {
            "product_categories": product_categories,
            "manufacturers": manufacturers,
            "product_models": product_models,
            "sites": sites,
            "storage_locations": storage_locations,
            "employees": employees,
            "departments": departments,
            "parent_assets": parent_assets,
        }

    def load_edit_form_data(
        self,
        entry: dict[str, Any],
    ) -> dict[str, Any]:
        """Lädt Stammdaten und den aktuellen Datensatz für „Eintrag bearbeiten“."""

        if not isinstance(entry, dict):
            raise ValueError("Ungültiger Inventareintrag.")

        data = self.load_create_form_data()
        record_type = str(
            entry.get("_record_type")
            or "asset"
        ).strip().casefold()

        if record_type == "asset":
            asset_id = entry.get("id")
            if asset_id is None:
                raise ValueError("Asset-ID fehlt.")

            response = (
                self.client.table(self.asset_table_name)
                .select(
                    "id,product_model_id,asset_tag,serial_number,purchase_date,"
                    "new_price,warranty_until,note,retired_at,status,"
                    "specifications,condition"
                )
                .eq("id", asset_id)
                .limit(1)
                .execute()
            )
            rows = [
                row
                for row in (response.data or [])
                if isinstance(row, dict)
            ]
            if not rows:
                raise ValueError(
                    "Der ausgewählte Inventareintrag existiert nicht mehr."
                )

            current = rows[0]
            current["_record_type"] = "asset"

            location = self._latest_open_relation(
                "asset_locations",
                "asset_id",
                asset_id,
                "valid_from",
            )
            if location:
                current["storage_location_id"] = location.get(
                    "storage_location_id"
                )

            assignment = self._latest_open_relation(
                "asset_assignments",
                "asset_id",
                asset_id,
                "valid_from",
            )
            if assignment:
                current["assigned_employee_id"] = assignment.get(
                    "employee_id"
                )
                current["assigned_department_id"] = assignment.get(
                    "department_id"
                )

            component_response = (
                self.client.table("asset_component_assignments")
                .select(
                    "id,parent_asset_id,child_asset_id,installed_at,removed_at"
                )
                .eq("child_asset_id", asset_id)
                .is_("removed_at", "null")
                .order("installed_at", desc=True)
                .limit(1)
                .execute()
            )
            components = [
                row
                for row in (component_response.data or [])
                if isinstance(row, dict)
            ]
            if components:
                current["connected_product_id"] = components[0].get(
                    "parent_asset_id"
                )

            self._add_site_context(
                current,
                data,
            )
            data["edit_entry"] = current
            return data

        if record_type != "stock":
            raise ValueError(
                f"Unbekannter Inventartyp: {record_type!r}."
            )

        product_model_id = entry.get("product_model_id")
        storage_location_id = entry.get("storage_location_id")
        condition = str(
            entry.get("condition")
            or ""
        ).strip().casefold()

        if (
            product_model_id is None
            or storage_location_id is None
            or not condition
        ):
            raise ValueError(
                "Der Mengenbestand enthält nicht genügend Daten zum Bearbeiten."
            )

        level_response = (
            self.client.table("stock_levels")
            .select("quantity")
            .eq("product_model_id", product_model_id)
            .eq("storage_location_id", storage_location_id)
            .eq("condition", condition)
            .limit(1)
            .execute()
        )
        levels = [
            row
            for row in (level_response.data or [])
            if isinstance(row, dict)
        ]
        if not levels:
            raise ValueError(
                "Der ausgewählte Mengenbestand existiert nicht mehr."
            )

        movement_response = (
            self.client.table("stock_movements")
            .select(
                "id,product_model_id,to_storage_location_id,to_condition,"
                "department_id,purchase_date,new_price,status,note,moved_at"
            )
            .eq("product_model_id", product_model_id)
            .eq("to_storage_location_id", storage_location_id)
            .eq("to_condition", condition)
            .order("moved_at", desc=True)
            .limit(1)
            .execute()
        )
        movements = [
            row
            for row in (movement_response.data or [])
            if isinstance(row, dict)
        ]
        movement = movements[0] if movements else {}

        location = next(
            (
                row
                for row in data.get("storage_locations", [])
                if isinstance(row, dict)
                and row.get("id") == storage_location_id
            ),
            {},
        )

        current = {
            "_record_type": "stock",
            "id": entry.get("id"),
            "product_model_id": product_model_id,
            "storage_location_id": storage_location_id,
            "condition": condition,
            "stock_quantity": levels[0].get("quantity"),
            "department_id": (
                movement.get("department_id")
                or (
                    location.get("department_id")
                    if isinstance(location, dict)
                    else None
                )
            ),
            "purchase_date": movement.get("purchase_date"),
            "new_price": movement.get("new_price") or 0,
            "status": movement.get("status") or "available",
            "note": movement.get("note"),
            "source_movement_id": movement.get("id"),
        }

        self._add_site_context(
            current,
            data,
        )
        data["edit_entry"] = current
        return data

    def update_inventory_entry(
        self,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Aktualisiert einen bestehenden Einzelartikel oder Mengenbestand."""

        if not isinstance(payload, dict):
            raise ValueError("Ungültige Daten für den Inventareintrag.")

        edit = payload.get("edit")
        if not isinstance(edit, dict):
            raise ValueError("Bearbeitungsinformationen fehlen.")

        record_type = str(
            edit.get("record_type")
            or ""
        ).strip().casefold()

        model_info = payload.get("model")
        if not isinstance(model_info, dict):
            raise ValueError("Produktmodell fehlt.")
        if str(model_info.get("mode") or "").strip().casefold() != "existing":
            raise ValueError(
                "Beim Bearbeiten muss ein bestehendes Produktmodell verwendet werden."
            )

        model_id, tracking_mode, _created_model, _created_manufacturer = (
            self._resolve_or_create_product_model(model_info)
        )

        if record_type == "asset":
            if tracking_mode not in ("serialized", "hybrid"):
                raise ValueError(
                    "Ein Einzelartikel kann nur einem Einzelartikel- oder "
                    "Hybrid-Produktmodell zugeordnet werden."
                )
        elif record_type == "stock":
            if tracking_mode not in ("quantity", "hybrid"):
                raise ValueError(
                    "Mengenbestand kann nur einem Mengen- oder "
                    "Hybrid-Produktmodell zugeordnet werden."
                )
        else:
            raise ValueError("Unbekannte Eintragsart.")

        condition = str(
            payload.get("condition")
            or ""
        ).strip().casefold()
        storage_location_id = payload.get(
            "storage_location_id"
        )

        if record_type == "asset":
            assignment = payload.get("assignment")
            department_id = (
                assignment.get("department_id")
                if isinstance(assignment, dict)
                else None
            )
        else:
            stock = payload.get("stock")
            department_id = (
                stock.get("department_id")
                if isinstance(stock, dict)
                else None
            )

        self._validate_location_department(
            storage_location_id=storage_location_id,
            department_id=department_id,
        )

        if record_type == "asset":
            result = self._update_serialized_asset(
                asset_id=edit.get("id"),
                model_id=model_id,
                condition=condition,
                storage_location_id=storage_location_id,
                asset_data=payload.get("asset"),
                assignment=payload.get("assignment"),
                parent_asset_id=payload.get("parent_asset_id"),
            )
            return {
                "entry_type": "asset",
                "id": result.get("id"),
                "asset_tag": result.get("asset_tag"),
            }

        result = self._update_stock_level(
            original=edit,
            model_id=model_id,
            condition=condition,
            storage_location_id=storage_location_id,
            stock_data=payload.get("stock"),
        )
        return {
            "entry_type": "stock",
            **result,
        }

    def create_inventory_entry(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Legt einen neuen Einzel- oder Mengenbestand an.

        Für ``serialized``-Einträge wird ein Datensatz in ``assets`` erzeugt
        und optional der aktuelle Lagerort, eine organisatorische Zuweisung
        sowie eine Komponentenbeziehung ergänzt. Mengenbestände werden korrekt
        über eine ``receipt``-Buchung in ``stock_movements`` aufgebaut.

        Der Aufruf benötigt aufgrund der vorhandenen RLS-Policies einen als
        ``admin`` verknüpften Supabase-Benutzer.
        """

        if not isinstance(payload, dict):
            raise ValueError("Ungültige Daten für den neuen Inventareintrag.")

        created_model_id: Any | None = None
        created_manufacturer_id: Any | None = None
        created_asset_id: Any | None = None

        try:
            model_info = payload.get("model")
            if not isinstance(model_info, dict):
                raise ValueError("Produktmodell fehlt.")

            model_id, tracking_mode, created_model_id, created_manufacturer_id = (
                self._resolve_or_create_product_model(model_info)
            )

            requested_entry_type = str(payload.get("entry_type") or "").strip().casefold()
            if tracking_mode == "serialized":
                entry_type = "asset"
            elif tracking_mode == "quantity":
                entry_type = "stock"
            elif tracking_mode == "hybrid":
                if requested_entry_type not in ("asset", "stock"):
                    raise ValueError("Bei einem Hybrid-Modell muss die Eintragsart gewählt werden.")
                entry_type = requested_entry_type
            else:
                raise ValueError(
                    f"Unbekannte Verwaltungsart des Produktmodells: {tracking_mode!r}."
                )

            condition = str(payload.get("condition") or "used").strip().casefold()
            storage_location_id = payload.get("storage_location_id")

            if entry_type == "asset":
                assignment = payload.get("assignment")
                department_id = (
                    assignment.get("department_id")
                    if isinstance(assignment, dict)
                    else None
                )
            else:
                stock_data = payload.get("stock")
                department_id = (
                    stock_data.get("department_id")
                    if isinstance(stock_data, dict)
                    else None
                )

            self._validate_location_department(
                storage_location_id=storage_location_id,
                department_id=department_id,
            )

            if entry_type == "asset":
                result = self._create_serialized_asset(
                    model_id=model_id,
                    condition=condition,
                    storage_location_id=storage_location_id,
                    asset_data=payload.get("asset"),
                    assignment=payload.get("assignment"),
                    parent_asset_id=payload.get("parent_asset_id"),
                )
                created_asset_id = result.get("id")
                return {
                    "entry_type": "asset",
                    "id": created_asset_id,
                    "product_model_id": model_id,
                    "asset_tag": result.get("asset_tag"),
                }

            result = self._create_stock_receipt(
                model_id=model_id,
                condition=condition,
                storage_location_id=storage_location_id,
                stock_data=payload.get("stock"),
            )
            return {
                "entry_type": "stock",
                "id": result.get("id"),
                "product_model_id": model_id,
                "quantity": result.get("quantity"),
            }

        except Exception as error:
            # PostgREST-Aufrufe über mehrere Tabellen sind keine gemeinsame
            # DB-Transaktion. Bei einem Folgefehler werden neu erzeugte
            # Stammdaten/Assets deshalb best-effort wieder entfernt.
            self._cleanup_failed_create(
                asset_id=created_asset_id,
                model_id=created_model_id,
                manufacturer_id=created_manufacturer_id,
            )

            message = str(error)
            if "row-level security" in message.casefold() or "permission denied" in message.casefold():
                raise RuntimeError(
                    "Der Inventareintrag konnte wegen der Supabase-Berechtigungen "
                    "nicht gespeichert werden. Der angemeldete Benutzer muss in "
                    "public.employees über auth_user_id verknüpft, aktiv und mit "
                    "app_role='admin' hinterlegt sein.\n\n"
                    f"Technischer Fehler: {error}"
                ) from error
            raise

    def _validate_location_department(
        self,
        *,
        storage_location_id: Any | None,
        department_id: Any | None,
    ) -> None:
        """Stellt die Hierarchie Standort -> Abteilung -> Lagerort sicher."""

        if storage_location_id is None:
            raise ValueError("Lagerort fehlt.")
        if department_id is None:
            raise ValueError("Abteilung fehlt.")

        location_response = (
            self.client.table("storage_locations")
            .select("id,site_id,department_id,name")
            .eq("id", storage_location_id)
            .limit(1)
            .execute()
        )
        locations = [
            row
            for row in (location_response.data or [])
            if isinstance(row, dict)
        ]
        if not locations:
            raise ValueError("Der ausgewählte Lagerort existiert nicht mehr.")

        location = locations[0]
        assigned_department_id = location.get("department_id")
        if assigned_department_id is None:
            raise ValueError(
                "Der ausgewählte Lagerort ist noch keiner Abteilung zugeordnet. "
                "Bitte zuerst unter Datei > Einstellungen die Hierarchie "
                "Standort > Abteilung > Lagerort vervollständigen."
            )
        if assigned_department_id != department_id:
            raise ValueError(
                "Der ausgewählte Lagerort gehört nicht zur ausgewählten Abteilung."
            )

        department_response = (
            self.client.table("departments")
            .select("id,site_id,name")
            .eq("id", department_id)
            .limit(1)
            .execute()
        )
        departments = [
            row
            for row in (department_response.data or [])
            if isinstance(row, dict)
        ]
        if not departments:
            raise ValueError("Die ausgewählte Abteilung existiert nicht mehr.")
        if departments[0].get("site_id") != location.get("site_id"):
            raise ValueError(
                "Standort, Abteilung und Lagerort sind nicht konsistent zugeordnet."
            )

    def _resolve_or_create_product_model(
        self,
        model_info: dict[str, Any],
    ) -> tuple[Any, str, Any | None, Any | None]:
        mode = str(model_info.get("mode") or "existing").strip().casefold()

        if mode == "existing":
            model_id = model_info.get("id")
            if model_id is None:
                raise ValueError("Produktmodell-ID fehlt.")

            response = (
                self.client
                .table("product_models")
                .select("id,tracking_mode")
                .eq("id", model_id)
                .limit(1)
                .execute()
            )
            rows = [row for row in (response.data or []) if isinstance(row, dict)]
            if not rows:
                raise ValueError("Das ausgewählte Produktmodell existiert nicht mehr.")
            tracking_mode = str(rows[0].get("tracking_mode") or "serialized").strip().casefold()
            return model_id, tracking_mode, None, None

        if mode != "new":
            raise ValueError("Ungültiger Produktmodell-Modus.")

        category_id = model_info.get("category_id")
        name = str(model_info.get("name") or "").strip()
        tracking_mode = str(model_info.get("tracking_mode") or "serialized").strip().casefold()
        unit_code = str(model_info.get("unit_code") or "piece").strip().casefold()

        if category_id is None:
            raise ValueError("Produktkategorie fehlt.")
        if not name:
            raise ValueError("Modellbezeichnung fehlt.")
        if tracking_mode not in ("serialized", "quantity", "hybrid"):
            raise ValueError("Ungültige Verwaltungsart für das Produktmodell.")
        if unit_code not in ("piece", "meter", "pack", "box"):
            raise ValueError("Ungültige Einheit für das Produktmodell.")

        manufacturer_id = model_info.get("manufacturer_id")
        created_manufacturer_id: Any | None = None
        if manufacturer_id is None:
            manufacturer_name = str(model_info.get("manufacturer_name") or "Keiner").strip() or "Keiner"
            manufacturer_id, created_manufacturer_id = self._find_or_create_manufacturer(
                manufacturer_name
            )

        row = {
            "manufacturer_id": manufacturer_id,
            "category_id": category_id,
            "name": name,
            "part_number": self._none_if_blank(model_info.get("part_number")),
            "sku": self._none_if_blank(model_info.get("sku")),
            "tracking_mode": tracking_mode,
            "unit_code": unit_code,
            "specifications": (
                model_info.get("specifications")
                if isinstance(model_info.get("specifications"), dict)
                else {}
            ),
            "is_active": True,
        }
        response = self.client.table("product_models").insert(row).execute()
        rows = [item for item in (response.data or []) if isinstance(item, dict)]
        if not rows or rows[0].get("id") is None:
            raise RuntimeError("Supabase hat für das neue Produktmodell keine ID zurückgegeben.")

        model_id = rows[0]["id"]
        return model_id, tracking_mode, model_id, created_manufacturer_id

    def _find_or_create_manufacturer(self, name: str) -> tuple[Any, Any | None]:
        response = self.client.table("manufacturers").select("id,name").execute()
        for row in (response.data or []):
            if not isinstance(row, dict):
                continue
            if str(row.get("name") or "").strip().casefold() == name.casefold():
                return row.get("id"), None

        response = self.client.table("manufacturers").insert({"name": name}).execute()
        rows = [row for row in (response.data or []) if isinstance(row, dict)]
        if not rows or rows[0].get("id") is None:
            raise RuntimeError("Supabase hat für den neuen Hersteller keine ID zurückgegeben.")
        manufacturer_id = rows[0]["id"]
        return manufacturer_id, manufacturer_id

    def _create_serialized_asset(
        self,
        *,
        model_id: Any,
        condition: str,
        storage_location_id: Any | None,
        asset_data: Any,
        assignment: Any,
        parent_asset_id: Any | None,
    ) -> dict[str, Any]:
        if not isinstance(asset_data, dict):
            raise ValueError("Assetdaten fehlen.")

        asset_tag = str(asset_data.get("asset_tag") or "").strip()
        if not asset_tag:
            raise ValueError("Produkterkennung fehlt.")
        if not asset_data.get("purchase_date"):
            raise ValueError("Kaufdatum fehlt.")

        row = {
            "product_model_id": model_id,
            "asset_tag": asset_tag,
            "serial_number": self._none_if_blank(asset_data.get("serial_number")),
            "purchase_date": asset_data.get("purchase_date"),
            "new_price": asset_data.get("new_price") or 0,
            "warranty_until": asset_data.get("warranty_until"),
            "retired_at": asset_data.get("retired_at"),
            "note": self._none_if_blank(asset_data.get("note")),
            "status": str(asset_data.get("status") or "available").strip().casefold(),
            "condition": condition,
            "specifications": (
                asset_data.get("specifications")
                if isinstance(asset_data.get("specifications"), dict)
                else {}
            ),
        }

        if storage_location_id is None:
            raise ValueError("Lagerort fehlt.")
        if not isinstance(assignment, dict) or assignment.get("department_id") is None:
            raise ValueError("Abteilung fehlt.")

        response = self.client.table(self.asset_table_name).insert(row).execute()
        rows = [item for item in (response.data or []) if isinstance(item, dict)]
        if not rows or rows[0].get("id") is None:
            raise RuntimeError("Supabase hat für das neue Asset keine ID zurückgegeben.")

        asset = rows[0]
        asset_id = asset["id"]

        try:
            if storage_location_id is not None:
                self.client.table("asset_locations").insert(
                    {
                        "asset_id": asset_id,
                        "storage_location_id": storage_location_id,
                    }
                ).execute()

            if isinstance(assignment, dict):
                employee_id = assignment.get("employee_id")
                department_id = assignment.get("department_id")
                if employee_id is not None or department_id is not None:
                    self.client.table("asset_assignments").insert(
                        {
                            "asset_id": asset_id,
                            "employee_id": employee_id,
                            "department_id": department_id,
                        }
                    ).execute()

            if parent_asset_id is not None:
                if parent_asset_id == asset_id:
                    raise ValueError("Ein Asset kann nicht mit sich selbst verbunden werden.")
                self.client.table("asset_component_assignments").insert(
                    {
                        "parent_asset_id": parent_asset_id,
                        "child_asset_id": asset_id,
                    }
                ).execute()
        except Exception:
            self._cleanup_failed_create(
                asset_id=asset_id,
                model_id=None,
                manufacturer_id=None,
            )
            raise

        return asset

    def _create_stock_receipt(
        self,
        *,
        model_id: Any,
        condition: str,
        storage_location_id: Any | None,
        stock_data: Any,
    ) -> dict[str, Any]:
        if storage_location_id is None:
            raise ValueError("Für Mengenbestand ist ein Lagerort erforderlich.")
        if not isinstance(stock_data, dict):
            raise ValueError("Bestandsdaten fehlen.")

        try:
            quantity = Decimal(str(stock_data.get("quantity")))
        except (InvalidOperation, TypeError, ValueError) as error:
            raise ValueError("Ungültige Bestandsmenge.") from error
        if quantity <= 0:
            raise ValueError("Die Bestandsmenge muss grösser als 0 sein.")

        department_id = stock_data.get("department_id")
        if department_id is None:
            raise ValueError("Abteilung fehlt.")
        purchase_date = stock_data.get("purchase_date")
        if not purchase_date:
            raise ValueError("Kaufdatum fehlt.")
        status = str(stock_data.get("status") or "").strip().casefold()
        if not status:
            raise ValueError("Status fehlt.")

        row = {
            "product_model_id": model_id,
            "from_storage_location_id": None,
            "to_storage_location_id": storage_location_id,
            "quantity": float(quantity),
            "movement_type": "receipt",
            "from_condition": None,
            "to_condition": condition,
            "department_id": department_id,
            "purchase_date": purchase_date,
            "new_price": stock_data.get("new_price") or 0,
            "status": status,
            "note": self._none_if_blank(stock_data.get("note")),
        }
        response = self.client.table("stock_movements").insert(row).execute()
        rows = [item for item in (response.data or []) if isinstance(item, dict)]
        if not rows or rows[0].get("id") is None:
            raise RuntimeError("Supabase hat für die Lagerbewegung keine ID zurückgegeben.")
        return rows[0]

    def _update_serialized_asset(
        self,
        *,
        asset_id: Any,
        model_id: Any,
        condition: str,
        storage_location_id: Any,
        asset_data: Any,
        assignment: Any,
        parent_asset_id: Any | None,
    ) -> dict[str, Any]:
        if asset_id is None:
            raise ValueError("Asset-ID fehlt.")
        if not isinstance(asset_data, dict):
            raise ValueError("Assetdaten fehlen.")
        if not isinstance(assignment, dict):
            raise ValueError("Zuweisungsdaten fehlen.")

        asset_tag = str(
            asset_data.get("asset_tag")
            or ""
        ).strip()
        if not asset_tag:
            raise ValueError("Produkterkennung fehlt.")
        if not asset_data.get("purchase_date"):
            raise ValueError("Kaufdatum fehlt.")
        if assignment.get("department_id") is None:
            raise ValueError("Abteilung fehlt.")
        if storage_location_id is None:
            raise ValueError("Lagerort fehlt.")

        duplicate_response = (
            self.client.table(self.asset_table_name)
            .select("id")
            .eq("asset_tag", asset_tag)
            .neq("id", asset_id)
            .limit(1)
            .execute()
        )
        if duplicate_response.data:
            raise ValueError(
                f"Die Produkterkennung „{asset_tag}“ wird bereits verwendet."
            )

        row = {
            "product_model_id": model_id,
            "asset_tag": asset_tag,
            "serial_number": self._none_if_blank(
                asset_data.get("serial_number")
            ),
            "purchase_date": asset_data.get("purchase_date"),
            "new_price": asset_data.get("new_price") or 0,
            "warranty_until": asset_data.get("warranty_until"),
            "note": self._none_if_blank(
                asset_data.get("note")
            ),
            "status": str(
                asset_data.get("status")
                or "available"
            ).strip().casefold(),
            "condition": condition,
            "specifications": (
                asset_data.get("specifications")
                if isinstance(
                    asset_data.get("specifications"),
                    dict,
                )
                else {}
            ),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        now = datetime.now(timezone.utc).isoformat()

        current_location = self._latest_open_relation(
            "asset_locations",
            "asset_id",
            asset_id,
            "valid_from",
        )
        current_location_id = (
            current_location.get("storage_location_id")
            if current_location
            else None
        )

        current_assignment = self._latest_open_relation(
            "asset_assignments",
            "asset_id",
            asset_id,
            "valid_from",
        )
        current_employee_id = (
            current_assignment.get("employee_id")
            if current_assignment
            else None
        )
        current_department_id = (
            current_assignment.get("department_id")
            if current_assignment
            else None
        )

        component_response = (
            self.client.table("asset_component_assignments")
            .select("id,parent_asset_id")
            .eq("child_asset_id", asset_id)
            .is_("removed_at", "null")
            .order("installed_at", desc=True)
            .limit(1)
            .execute()
        )
        components = [
            item
            for item in (component_response.data or [])
            if isinstance(item, dict)
        ]
        current_parent_id = (
            components[0].get("parent_asset_id")
            if components
            else None
        )

        if parent_asset_id == asset_id:
            raise ValueError(
                "Ein Asset kann nicht mit sich selbst verbunden werden."
            )

        # Erst den Hauptdatensatz aktualisieren; alle Pflichtdaten und
        # Duplikate wurden vorher validiert.
        response = (
            self.client.table(self.asset_table_name)
            .update(row)
            .eq("id", asset_id)
            .execute()
        )
        rows = [
            item
            for item in (response.data or [])
            if isinstance(item, dict)
        ]

        if current_location_id != storage_location_id:
            (
                self.client.table("asset_locations")
                .update({"valid_to": now})
                .eq("asset_id", asset_id)
                .is_("valid_to", "null")
                .execute()
            )
            self.client.table("asset_locations").insert(
                {
                    "asset_id": asset_id,
                    "storage_location_id": storage_location_id,
                }
            ).execute()

        desired_employee_id = assignment.get("employee_id")
        desired_department_id = assignment.get("department_id")

        if (
            current_employee_id != desired_employee_id
            or current_department_id != desired_department_id
        ):
            (
                self.client.table("asset_assignments")
                .update({"valid_to": now})
                .eq("asset_id", asset_id)
                .is_("valid_to", "null")
                .execute()
            )
            self.client.table("asset_assignments").insert(
                {
                    "asset_id": asset_id,
                    "employee_id": desired_employee_id,
                    "department_id": desired_department_id,
                }
            ).execute()

        if current_parent_id != parent_asset_id:
            (
                self.client.table("asset_component_assignments")
                .update({"removed_at": now})
                .eq("child_asset_id", asset_id)
                .is_("removed_at", "null")
                .execute()
            )
            if parent_asset_id is not None:
                self.client.table("asset_component_assignments").insert(
                    {
                        "parent_asset_id": parent_asset_id,
                        "child_asset_id": asset_id,
                    }
                ).execute()

        if rows:
            return rows[0]

        # PostgREST kann je nach Prefer-Header keine Zeile zurückliefern.
        return {
            "id": asset_id,
            "asset_tag": asset_tag,
        }

    def _update_stock_level(
        self,
        *,
        original: dict[str, Any],
        model_id: Any,
        condition: str,
        storage_location_id: Any,
        stock_data: Any,
    ) -> dict[str, Any]:
        if not isinstance(stock_data, dict):
            raise ValueError("Bestandsdaten fehlen.")

        try:
            desired_quantity = Decimal(
                str(stock_data.get("quantity"))
            )
        except (InvalidOperation, TypeError, ValueError) as error:
            raise ValueError("Ungültige Bestandsmenge.") from error

        if desired_quantity <= 0:
            raise ValueError(
                "Die Bestandsmenge muss grösser als 0 sein. "
                "Zum vollständigen Entfernen bitte „Einträge löschen“ verwenden."
            )

        department_id = stock_data.get("department_id")
        purchase_date = stock_data.get("purchase_date")
        status = str(
            stock_data.get("status")
            or ""
        ).strip().casefold()

        if department_id is None:
            raise ValueError("Abteilung fehlt.")
        if not purchase_date:
            raise ValueError("Kaufdatum fehlt.")
        if not status:
            raise ValueError("Status fehlt.")

        old_model_id = original.get("product_model_id")
        old_location_id = original.get("storage_location_id")
        old_condition = str(
            original.get("condition")
            or ""
        ).strip().casefold()

        level_response = (
            self.client.table("stock_levels")
            .select("quantity")
            .eq("product_model_id", old_model_id)
            .eq("storage_location_id", old_location_id)
            .eq("condition", old_condition)
            .limit(1)
            .execute()
        )
        levels = [
            row
            for row in (level_response.data or [])
            if isinstance(row, dict)
        ]
        if not levels:
            raise ValueError(
                "Der ursprüngliche Mengenbestand existiert nicht mehr."
            )

        current_quantity = Decimal(
            str(levels[0].get("quantity") or 0)
        )
        if current_quantity <= 0:
            raise ValueError(
                "Der ursprüngliche Mengenbestand ist bereits leer."
            )

        same_identity = (
            old_model_id == model_id
            and old_location_id == storage_location_id
            and old_condition == condition
        )

        metadata = {
            "department_id": department_id,
            "purchase_date": purchase_date,
            "new_price": stock_data.get("new_price") or 0,
            "status": status,
            "note": self._none_if_blank(
                stock_data.get("note")
            ),
        }

        if same_identity:
            source_movement_id = original.get(
                "source_movement_id"
            )
            if source_movement_id is not None:
                (
                    self.client.table("stock_movements")
                    .update(metadata)
                    .eq("id", source_movement_id)
                    .execute()
                )

            difference = desired_quantity - current_quantity
            if difference != 0:
                movement = {
                    "product_model_id": model_id,
                    "from_storage_location_id": (
                        storage_location_id
                        if difference < 0
                        else None
                    ),
                    "to_storage_location_id": (
                        storage_location_id
                        if difference > 0
                        else None
                    ),
                    "quantity": float(abs(difference)),
                    "movement_type": "adjustment",
                    "from_condition": (
                        condition
                        if difference < 0
                        else None
                    ),
                    "to_condition": (
                        condition
                        if difference > 0
                        else None
                    ),
                    **metadata,
                }
                self.client.table("stock_movements").insert(
                    movement
                ).execute()

            return {
                "product_model_id": model_id,
                "quantity": float(desired_quantity),
            }

        # Bei einer Änderung von Produktmodell, Lagerort oder Zustand wird
        # der alte Bestand nachvollziehbar ausgebucht und am neuen Ziel
        # wieder eingebucht. Historische Bewegungen bleiben unverändert.
        self.client.table("stock_movements").insert(
            {
                "product_model_id": old_model_id,
                "from_storage_location_id": old_location_id,
                "to_storage_location_id": None,
                "quantity": float(current_quantity),
                "movement_type": "adjustment",
                "from_condition": old_condition,
                "to_condition": None,
                "department_id": original.get("department_id"),
                "new_price": 0,
                "status": "available",
                "note": (
                    "Bestand durch Bearbeitung des Inventareintrags "
                    "am bisherigen Ort ausgebucht."
                ),
            }
        ).execute()

        self.client.table("stock_movements").insert(
            {
                "product_model_id": model_id,
                "from_storage_location_id": None,
                "to_storage_location_id": storage_location_id,
                "quantity": float(desired_quantity),
                "movement_type": "receipt",
                "from_condition": None,
                "to_condition": condition,
                **metadata,
            }
        ).execute()

        return {
            "product_model_id": model_id,
            "quantity": float(desired_quantity),
        }

    def _latest_open_relation(
        self,
        table_name: str,
        key_name: str,
        key_value: Any,
        order_column: str,
    ) -> dict[str, Any] | None:
        response = (
            self.client.table(table_name)
            .select("*")
            .eq(key_name, key_value)
            .is_("valid_to", "null")
            .order(order_column, desc=True)
            .limit(1)
            .execute()
        )
        rows = [
            row
            for row in (response.data or [])
            if isinstance(row, dict)
        ]
        return rows[0] if rows else None

    @staticmethod
    def _add_site_context(
        entry: dict[str, Any],
        form_data: dict[str, Any],
    ) -> None:
        location_id = entry.get("storage_location_id")
        department_id = (
            entry.get("assigned_department_id")
            or entry.get("department_id")
        )

        location = next(
            (
                row
                for row in form_data.get("storage_locations", [])
                if isinstance(row, dict)
                and row.get("id") == location_id
            ),
            None,
        )
        department = next(
            (
                row
                for row in form_data.get("departments", [])
                if isinstance(row, dict)
                and row.get("id") == department_id
            ),
            None,
        )

        if isinstance(location, dict):
            entry["site_id"] = location.get("site_id")
            if entry.get("department_id") is None:
                entry["department_id"] = location.get(
                    "department_id"
                )
            return

        if isinstance(department, dict):
            entry["site_id"] = department.get("site_id")

    @staticmethod
    def _validate_stock_delete(
        entry: dict[str, Any],
    ) -> None:
        required = (
            ("product_model_id", "Produktmodell"),
            ("storage_location_id", "Lagerort"),
            ("condition", "Zustand"),
        )
        for field_name, label in required:
            value = entry.get(field_name)
            if value is None or not str(value).strip():
                raise ValueError(
                    f"Mengenbestand kann nicht gelöscht werden: {label} fehlt."
                )

    def _delete_asset(
        self,
        asset_id: Any,
    ) -> None:
        """Entfernt ein serialisiertes Asset samt direkten Zuordnungen."""

        # Alle aktuell vorhandenen RESTRICT-Fremdschlüssel werden vor dem
        # eigentlichen Asset-Datensatz bereinigt. stock_movements.related_asset_id
        # besitzt ON DELETE SET NULL und muss deshalb nicht gelöscht werden.
        dependencies = (
            ("asset_component_assignments", "child_asset_id"),
            ("asset_component_assignments", "parent_asset_id"),
            ("software_installations", "asset_id"),
            ("asset_assignments", "asset_id"),
            ("asset_locations", "asset_id"),
        )

        for table_name, column_name in dependencies:
            (
                self.client
                .table(table_name)
                .delete()
                .eq(column_name, asset_id)
                .execute()
            )

        (
            self.client
            .table(self.asset_table_name)
            .delete()
            .eq("id", asset_id)
            .execute()
        )

    def _delete_stock_level(
        self,
        entry: dict[str, Any],
    ) -> bool:
        """Bucht den aktuellen Mengenbestand der ausgewählten Zeile auf 0."""

        product_model_id = entry.get("product_model_id")
        storage_location_id = entry.get("storage_location_id")
        condition = str(entry.get("condition") or "").strip().casefold()

        response = (
            self.client
            .table("stock_levels")
            .select("quantity")
            .eq("product_model_id", product_model_id)
            .eq("storage_location_id", storage_location_id)
            .eq("condition", condition)
            .limit(1)
            .execute()
        )

        rows = [
            row
            for row in (response.data or [])
            if isinstance(row, dict)
        ]
        if not rows:
            return False

        try:
            current_quantity = Decimal(
                str(rows[0].get("quantity") or 0)
            )
        except (InvalidOperation, ValueError, TypeError) as exc:
            raise ValueError(
                "Der aktuelle Mengenbestand konnte nicht gelesen werden."
            ) from exc

        if current_quantity <= 0:
            return False

        location_response = (
            self.client
            .table("storage_locations")
            .select("department_id")
            .eq("id", storage_location_id)
            .limit(1)
            .execute()
        )
        location_rows = [
            row
            for row in (location_response.data or [])
            if isinstance(row, dict)
        ]
        department_id = (
            location_rows[0].get("department_id")
            if location_rows
            else None
        )

        movement = {
            "product_model_id": product_model_id,
            "from_storage_location_id": storage_location_id,
            "to_storage_location_id": None,
            "quantity": float(current_quantity),
            "movement_type": "adjustment",
            "from_condition": condition,
            "to_condition": None,
            "department_id": department_id,
            "note": (
                "Bestand über ITAssetFlow über "
                "„Einträge löschen“ vollständig ausgebucht."
            ),
        }

        self.client.table("stock_movements").insert(movement).execute()
        return True

    def _cleanup_failed_create(
        self,
        *,
        asset_id: Any | None,
        model_id: Any | None,
        manufacturer_id: Any | None,
    ) -> None:
        try:
            if asset_id is not None:
                for table, field in (
                    ("asset_component_assignments", "child_asset_id"),
                    ("asset_assignments", "asset_id"),
                    ("asset_locations", "asset_id"),
                ):
                    try:
                        self.client.table(table).delete().eq(field, asset_id).execute()
                    except Exception:
                        logger.exception(
                            "Rollback für %s bei Asset %r fehlgeschlagen.",
                            table,
                            asset_id,
                        )
                self.client.table(self.asset_table_name).delete().eq("id", asset_id).execute()

            if model_id is not None:
                self.client.table("product_models").delete().eq("id", model_id).execute()

            if manufacturer_id is not None:
                self.client.table("manufacturers").delete().eq("id", manufacturer_id).execute()
        except Exception:
            logger.exception("Best-effort-Rollback des fehlgeschlagenen Creates ist unvollständig.")

    @staticmethod
    def _none_if_blank(value: Any) -> Any | None:
        if value is None:
            return None
        if isinstance(value, str):
            text = value.strip()
            return text or None
        return value

    def _load_stock_levels(self) -> list[dict[str, Any]]:
        """Lädt den berechneten Mengenbestand nach Lagerort und Zustand."""

        return self._load_rows(
            "stock_levels",
            order_column=None,
            required=False,
        )

    # ------------------------------------------------------------------
    # Laden / Zusammenführen
    # ------------------------------------------------------------------

    def _load_rows(
        self,
        table_name: str,
        *,
        order_column: str | None,
        required: bool,
        select_expression: str = "*",
    ) -> list[dict[str, Any]]:
        try:
            query = self.client.table(table_name).select(select_expression)
            if order_column:
                query = query.order(order_column)
            response = query.execute()
        except Exception as error:
            message = f"Tabelle/View {table_name!r} konnte nicht gelesen werden: {error}"
            if required:
                raise RuntimeError(message) from error
            self._warn(message, exc_info=True)
            return []

        return [
            row
            for row in (response.data or [])
            if isinstance(row, dict)
        ]

    @staticmethod
    def _merge_catalog_data(
        assets: list[dict[str, Any]],
        product_models: list[dict[str, Any]],
        product_categories: list[dict[str, Any]],
        manufacturers: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        models_by_id = {
            row.get("id"): row
            for row in product_models
            if row.get("id") is not None
        }
        categories_by_id = {
            row.get("id"): row
            for row in product_categories
            if row.get("id") is not None
        }
        manufacturers_by_id = {
            row.get("id"): row
            for row in manufacturers
            if row.get("id") is not None
        }

        result: list[dict[str, Any]] = []

        for source_asset in assets:
            asset = dict(source_asset)
            model = models_by_id.get(asset.get("product_model_id"))

            if isinstance(model, dict):
                for key, value in model.items():
                    asset[f"product_model_{key}"] = value

                category = categories_by_id.get(model.get("category_id"))
                if isinstance(category, dict):
                    for key, value in category.items():
                        asset[f"product_category_{key}"] = value

                    # Tabelle und Kategorie-Filter verwenden exakt denselben Namen.
                    asset["product_category_name"] = get_category_label(asset)

                    AssetRepository._merge_specification_columns(
                        asset,
                        model,
                        category,
                    )

                manufacturer = manufacturers_by_id.get(model.get("manufacturer_id"))
                if isinstance(manufacturer, dict):
                    asset["manufacturer_name"] = manufacturer.get("name")

            result.append(asset)

        return result

    @classmethod
    def _merge_stock_level_rows(
        cls,
        stock_levels: list[dict[str, Any]],
        product_models: list[dict[str, Any]],
        product_categories: list[dict[str, Any]],
        manufacturers: list[dict[str, Any]],
        storage_locations: list[dict[str, Any]],
        sites: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Bereitet ``stock_levels`` wie normale Inventarzeilen für die UI auf.

        Eine Zeile entspricht Produktmodell + Lagerort + Zustand.
        Null-/Negativbestände werden nicht als physischer Lagerbestand
        dargestellt. Die Historie bleibt vollständig in ``stock_movements``.
        """

        models_by_id = cls._index_by_id(product_models)
        categories_by_id = cls._index_by_id(product_categories)
        manufacturers_by_id = cls._index_by_id(manufacturers)
        locations_by_id = cls._index_by_id(storage_locations)
        sites_by_id = cls._index_by_id(sites)

        result: list[dict[str, Any]] = []

        for level in stock_levels:
            product_model_id = level.get("product_model_id")
            storage_location_id = level.get("storage_location_id")
            condition = level.get("condition")
            quantity = level.get("quantity")

            try:
                numeric_quantity = Decimal(str(quantity or 0))
            except (InvalidOperation, ValueError, TypeError):
                logger.warning(
                    "Ungültige Lagermenge in stock_levels: %r",
                    quantity,
                )
                continue

            if numeric_quantity <= 0:
                continue

            model = models_by_id.get(product_model_id)
            if not isinstance(model, dict):
                logger.warning(
                    "stock_levels verweist auf unbekanntes Produktmodell %r.",
                    product_model_id,
                )
                continue

            tracking_mode = str(
                model.get("tracking_mode") or ""
            ).strip().casefold()
            if tracking_mode not in ("quantity", "hybrid"):
                logger.warning(
                    "Bestand für Produktmodell %r mit tracking_mode %r ignoriert.",
                    product_model_id,
                    tracking_mode,
                )
                continue

            row: dict[str, Any] = {
                "id": (
                    f"stock:{product_model_id}:"
                    f"{storage_location_id}:{condition or 'unknown'}"
                ),
                "_record_type": "stock",
                "product_model_id": product_model_id,
                "storage_location_id": storage_location_id,
                "condition": condition,
                "stock_quantity": quantity,
                "current_usage_state": "stored",
                "inventory_usage": USAGE_STATE_LABELS["stored"],
                "site_name": "",
                "department_name": "",
                "connected_product": "",
            }

            for key, value in model.items():
                row[f"product_model_{key}"] = value

            category = categories_by_id.get(model.get("category_id"))
            if isinstance(category, dict):
                for key, value in category.items():
                    row[f"product_category_{key}"] = value

                row["product_category_name"] = get_category_label(row)
                cls._merge_specification_columns(
                    row,
                    model,
                    category,
                )

            manufacturer = manufacturers_by_id.get(
                model.get("manufacturer_id")
            )
            if isinstance(manufacturer, dict):
                row["manufacturer_name"] = manufacturer.get("name")

            location = locations_by_id.get(storage_location_id)
            row["storage_location"] = cls._location_label(
                location,
                storage_location_id,
            )

            if isinstance(location, dict):
                site_id = location.get("site_id")
                row["site_id"] = site_id
                row["site_name"] = cls._site_label(
                    sites_by_id.get(site_id),
                    site_id,
                )

            result.append(row)

        return result

    @staticmethod
    def _merge_specification_columns(
        asset: dict[str, Any],
        model: dict[str, Any],
        category: dict[str, Any],
    ) -> None:
        """Bereitet Spezifikationen robust für die Detailansicht auf.

        1. Liest product_models.specifications und assets.specifications.
        2. Normalisiert ältere/deutsche JSON-Schlüssel auf aktuelle Keys.
        3. Nutzt specification_schema für Reihenfolge, Label und Scope.
        4. Zeigt zusätzlich gespeicherte JSON-Werte, die noch nicht im
           Schema definiert sind, statt sie still zu verstecken.
        """

        fields = get_specification_fields(
            category.get("specification_schema")
        )

        model_specs = normalize_specifications(
            model.get("specifications")
        )
        asset_specs = normalize_specifications(
            asset.get("specifications")
        )

        labels = asset.setdefault("_specification_labels", {})
        configured_keys: set[str] = set()

        # Zuerst die im Kategorie-Schema definierten Felder in der
        # dort festgelegten Reihenfolge anlegen.
        for field in fields:
            raw_key = str(field.get("key") or "").strip()
            key = normalize_specification_key(raw_key)
            if not key:
                continue

            configured_keys.add(key)
            column_name = specification_column_name(key)
            scope = str(
                field.get("scope") or "model"
            ).strip().casefold()

            if scope == "asset":
                value = asset_specs.get(key)
                if value is None:
                    value = model_specs.get(key)
            else:
                value = model_specs.get(key)

                # Ein konkreter Asset-Wert darf einen Modellwert ergänzen/
                # überschreiben, falls das Feld historisch dort gespeichert
                # wurde. Dadurch gehen migrierte Daten nicht verloren.
                if key in asset_specs and asset_specs.get(key) is not None:
                    value = asset_specs.get(key)

            asset[column_name] = value
            labels[column_name] = get_specification_label(field)

        # Danach alle tatsächlich gespeicherten, aber noch nicht im Schema
        # beschriebenen Werte ergänzen. So bleibt die Detailansicht auch bei
        # älteren Datenständen vollständig.
        merged_specs = dict(model_specs)
        merged_specs.update(
            {
                key: value
                for key, value in asset_specs.items()
                if value is not None
            }
        )

        for key, value in merged_specs.items():
            if key in configured_keys:
                continue

            column_name = specification_column_name(key)
            asset[column_name] = value
            labels[column_name] = fallback_specification_label(key)

        asset["_has_specification_schema"] = bool(fields)
        asset["_has_specification_values"] = any(
            value is not None
            and not (
                isinstance(value, str)
                and not value.strip()
            )
            for value in merged_specs.values()
        )

    # ------------------------------------------------------------------
    # Aktueller fachlicher Zustand
    # ------------------------------------------------------------------

    def enrich_current_context(
        self,
        assets: list[dict[str, Any]],
        *,
        storage_locations: list[dict[str, Any]] | None = None,
        sites: list[dict[str, Any]] | None = None,
    ) -> None:
        """Ergänzt den aktuell abgeleiteten Nutzungszustand eines Assets.

        Priorität des Zustands:
        1. aktiv als Komponente eingebaut
        2. aktuell Person/Abteilung zugewiesen
        3. aktueller Lagerort
        4. nicht zugeordnet

        Ort und Zuweisung werden trotzdem separat angezeigt, falls beide Daten
        vorhanden sind. So bleiben widersprüchliche Daten in der UI sichtbar.
        """

        if not assets:
            return

        self._initialize_usage_fields(assets)
        self._enrich_locations_and_assignments(
            assets,
            storage_locations=storage_locations,
            sites=sites,
        )
        self._enrich_component_assignments(assets)

    @staticmethod
    def _initialize_usage_fields(assets: list[dict[str, Any]]) -> None:
        for asset in assets:
            asset["current_usage_state"] = "unlocated"
            asset["inventory_usage"] = USAGE_STATE_LABELS["unlocated"]
            asset["connected_product"] = ""
            asset["connected_product_id"] = None
            asset["site_name"] = ""
            asset["site_id"] = None
            asset["department_name"] = ""
            asset["assigned_to"] = ""  # intern für spätere Detailansichten
            asset["storage_location"] = ""
            asset.setdefault("stock_quantity", None)

    def _enrich_locations_and_assignments(
        self,
        assets: list[dict[str, Any]],
        *,
        storage_locations: list[dict[str, Any]] | None = None,
        sites: list[dict[str, Any]] | None = None,
    ) -> None:
        asset_locations = self._load_rows(
            "asset_locations",
            order_column="id",
            required=False,
            select_expression=(
                "id,asset_id,storage_location_id,valid_from,valid_to"
            ),
        )
        if storage_locations is None:
            storage_locations = self._load_rows(
                "storage_locations",
                order_column="id",
                required=False,
            )
        if sites is None:
            sites = self._load_rows(
                "sites",
                order_column="name",
                required=False,
                select_expression="id,name",
            )
        asset_assignments = self._load_rows(
            "asset_assignments",
            order_column="id",
            required=False,
            select_expression=(
                "id,asset_id,employee_id,department_id,valid_from,valid_to"
            ),
        )
        employees = self._load_rows(
            "employees",
            order_column="id",
            required=False,
            select_expression=(
                "id,employee_number,first_name,last_name,email,department_id,is_active"
            ),
        )
        departments = self._load_rows(
            "departments",
            order_column="id",
            required=False,
            select_expression="id,name,site_id",
        )

        current_locations = self._latest_open_rows(asset_locations, "asset_id", "valid_from")
        current_assignments = self._latest_open_rows(asset_assignments, "asset_id", "valid_from")
        locations_by_id = self._index_by_id(storage_locations)
        sites_by_id = self._index_by_id(sites)
        employees_by_id = self._index_by_id(employees)
        departments_by_id = self._index_by_id(departments)

        for asset in assets:
            asset_id = asset.get("id")

            location_row = current_locations.get(asset_id)
            if location_row is not None:
                location_id = location_row.get("storage_location_id")
                location = locations_by_id.get(location_id)
                asset["storage_location_id"] = location_id
                asset["storage_location"] = self._location_label(location, location_id)

                if isinstance(location, dict):
                    site_id = location.get("site_id")
                    asset["site_id"] = site_id
                    asset["site_name"] = self._site_label(
                        sites_by_id.get(site_id),
                        site_id,
                    )

                asset["current_usage_state"] = "stored"
                asset["inventory_usage"] = USAGE_STATE_LABELS["stored"]

            assignment = current_assignments.get(asset_id)
            if assignment is not None:
                employee_id = assignment.get("employee_id")
                department_id = assignment.get("department_id")
                asset["assigned_employee_id"] = employee_id

                # Bei einer Personenzuweisung wird für die Haupttabelle trotzdem
                # deren Abteilung angezeigt. Direkte Abteilungszuweisungen bleiben
                # unverändert möglich.
                if employee_id is not None:
                    employee = employees_by_id.get(employee_id)
                    asset["assigned_to"] = self._employee_label(employee, employee_id)
                    if isinstance(employee, dict):
                        employee_department_id = employee.get("department_id")
                        if employee_department_id is not None:
                            department_id = employee_department_id
                elif department_id is not None:
                    department = departments_by_id.get(department_id)
                    asset["assigned_to"] = self._department_label(department, department_id)

                asset["assigned_department_id"] = department_id

                if department_id is not None:
                    department = departments_by_id.get(department_id)
                    asset["department_name"] = self._department_label(
                        department,
                        department_id,
                    )

                    if not asset.get("site_name") and isinstance(department, dict):
                        site_id = department.get("site_id")
                        asset["site_id"] = site_id
                        asset["site_name"] = self._site_label(
                            sites_by_id.get(site_id),
                            site_id,
                        )

                asset["current_usage_state"] = "assigned"
                asset["inventory_usage"] = USAGE_STATE_LABELS["assigned"]

    def _enrich_component_assignments(
        self,
        assets: list[dict[str, Any]],
    ) -> None:
        rows = self._load_rows(
            "asset_component_assignments",
            order_column="id",
            required=False,
            select_expression=(
                "id,parent_asset_id,child_asset_id,installed_at,removed_at"
            ),
        )
        assets_by_id = self._index_by_id(assets)

        for row in rows:
            if row.get("removed_at") is not None:
                continue

            child = assets_by_id.get(row.get("child_asset_id"))
            if child is None:
                continue

            parent_id = row.get("parent_asset_id")
            parent = assets_by_id.get(parent_id)

            child["current_usage_state"] = "connected"
            child["inventory_usage"] = USAGE_STATE_LABELS["connected"]
            child["connected_product_id"] = parent_id
            child["connected_product"] = (
                get_asset_identifier(parent)
                if parent is not None
                else str(parent_id or "")
            )

    # ------------------------------------------------------------------
    # Hilfsfunktionen
    # ------------------------------------------------------------------

    @staticmethod
    def _index_by_id(rows: list[dict[str, Any]]) -> dict[Any, dict[str, Any]]:
        return {
            row.get("id"): row
            for row in rows
            if row.get("id") is not None
        }

    @staticmethod
    def _latest_open_rows(
        rows: list[dict[str, Any]],
        key_field: str,
        date_field: str,
    ) -> dict[Any, dict[str, Any]]:
        current: dict[Any, dict[str, Any]] = {}
        for row in rows:
            if row.get("valid_to") is not None:
                continue
            key = row.get(key_field)
            if key is None:
                continue
            existing = current.get(key)
            if existing is None or str(row.get(date_field) or "") >= str(
                existing.get(date_field) or ""
            ):
                current[key] = row
        return current

    @staticmethod
    def _employee_label(employee: dict[str, Any] | None, employee_id: Any) -> str:
        if isinstance(employee, dict):
            full_name = " ".join(
                part.strip()
                for part in (
                    str(employee.get("first_name") or ""),
                    str(employee.get("last_name") or ""),
                )
                if part.strip()
            )
            if full_name:
                return full_name
            number = str(employee.get("employee_number") or "").strip()
            if number:
                return number
        return f"Mitarbeiter #{employee_id}"

    @staticmethod
    def _site_label(site: dict[str, Any] | None, site_id: Any) -> str:
        if isinstance(site, dict):
            name = str(site.get("name") or "").strip()
            if name:
                return name
        return f"Standort #{site_id}" if site_id is not None else ""

    @staticmethod
    def _department_label(department: dict[str, Any] | None, department_id: Any) -> str:
        if isinstance(department, dict):
            name = str(department.get("name") or "").strip()
            if name:
                return name
        return f"Abteilung #{department_id}"

    @staticmethod
    def _location_label(location: dict[str, Any] | None, location_id: Any) -> str:
        if isinstance(location, dict):
            name = str(location.get("name") or "").strip()
            code = str(location.get("code") or "").strip()
            if name and code:
                return f"{name} ({code})"
            if name:
                return name
            if code:
                return code
        return f"Lagerort #{location_id}"

    def _warn(
        self,
        message: str,
        *,
        exc_info: bool = False,
    ) -> None:
        logger.warning(message, exc_info=exc_info)
        if self.catalog_warning:
            if message not in self.catalog_warning:
                self.catalog_warning = f"{self.catalog_warning}\n{message}"
        else:
            self.catalog_warning = message