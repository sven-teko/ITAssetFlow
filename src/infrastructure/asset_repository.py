from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Any

from supabase import Client

from inventory import (
    get_asset_identifier,
    get_category_label,
    get_inventory_group,
    fallback_specification_label,
    get_specification_fields,
    get_specification_label,
    normalize_specification_key,
    normalize_specifications,
    specification_column_name,
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
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Lädt Einzel-Assets und mengenverwaltete Lagerbestände gemeinsam.

        Rückgabe:
        - Einzelgeräte aus ``assets``
        - Bestandszeilen aus ``stock_levels`` für quantity/hybrid-Modelle

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
        stock_levels = self.load_stock_levels()

        if not product_models:
            self._add_warning(
                "Keine Produktmodelle lesbar. Prüfe SELECT/RLS für product_models."
            )
        if not product_categories:
            self._add_warning(
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
        )

        stock_rows = self._merge_stock_level_rows(
            stock_levels,
            product_models,
            product_categories,
            manufacturers,
            storage_locations,
        )

        return merged_assets + stock_rows, product_categories

    def load_product_categories(self) -> list[dict[str, Any]]:
        """Kompatibilitätsmethode für ältere MainWindow-Versionen."""

        return self._load_rows(
            "product_categories",
            order_column="name",
            required=False,
        )

    def enrich_component_state(self, assets: list[dict[str, Any]]) -> None:
        """Kompatibilitätsmethode: ergänzt mindestens den Komponenteneinbau."""

        self._enrich_component_assignments(assets)

    def load_stock_levels(self) -> list[dict[str, Any]]:
        """Lädt den berechneten Mengenbestand nach Lagerort und Zustand."""

        return self._load_rows(
            "stock_levels",
            order_column=None,
            required=False,
        )

    def load_stock_movements(self) -> list[dict[str, Any]]:
        """Lädt das unveränderliche Journal der Lagerbewegungen."""

        return self._load_rows(
            "stock_movements",
            order_column="moved_at",
            required=False,
        )

    def load_stock_counts(self) -> list[dict[str, Any]]:
        """Lädt Inventurzählungen; für eine spätere Mengenbestandsansicht."""

        return self._load_rows(
            "stock_counts",
            order_column="counted_at",
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
            logger.warning(message, exc_info=True)
            self._add_warning(message)
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
                "inventory_usage": "Im Lager",
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
        )
        self._enrich_component_assignments(assets)
        self._finalize_usage_state(assets)

    @staticmethod
    def _initialize_usage_fields(assets: list[dict[str, Any]]) -> None:
        for asset in assets:
            asset["current_usage_state"] = "unlocated"
            asset["inventory_usage"] = "Nicht zugeordnet"
            asset["connected_product"] = ""
            asset["connected_product_id"] = None
            asset["department_name"] = ""
            asset["assigned_to"] = ""  # intern für spätere Detailansichten
            asset["storage_location"] = ""
            asset.setdefault("stock_quantity", None)

    def _enrich_locations_and_assignments(
        self,
        assets: list[dict[str, Any]],
        *,
        storage_locations: list[dict[str, Any]] | None = None,
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
            select_expression="id,name",
        )

        current_locations = self._latest_open_rows(asset_locations, "asset_id", "valid_from")
        current_assignments = self._latest_open_rows(asset_assignments, "asset_id", "valid_from")
        locations_by_id = self._index_by_id(storage_locations)
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
                asset["current_usage_state"] = "stored"
                asset["inventory_usage"] = "Im Lager"

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
                        department_id = employee.get("department_id")
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

                asset["current_usage_state"] = "assigned"
                asset["inventory_usage"] = "Zugewiesen"

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
            child["inventory_usage"] = "Verbunden"
            child["connected_product_id"] = parent_id
            child["connected_product"] = (
                get_asset_identifier(parent)
                if parent is not None
                else str(parent_id or "")
            )

    @staticmethod
    def _finalize_usage_state(assets: list[dict[str, Any]]) -> None:
        # Absichtlich klein gehalten. Die Methode dient als Erweiterungspunkt
        # für spätere Regeln, ohne MainWindow oder Tabellenwidget anzupassen.
        for asset in assets:
            if asset.get("current_usage_state") == "unlocated":
                asset["inventory_usage"] = "Nicht zugeordnet"

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

    def _add_warning(self, message: str) -> None:
        logger.warning(message)
        if self.catalog_warning:
            if message not in self.catalog_warning:
                self.catalog_warning = f"{self.catalog_warning}\n{message}"
        else:
            self.catalog_warning = message

    # ------------------------------------------------------------------
    # Kompatibilität mit älteren Repository-Versionen
    # ------------------------------------------------------------------

    def load_assets_with_product_model(self) -> Any:
        """Ältere API: versucht weiterhin das PostgREST-Embedding."""

        return (
            self.client
            .table(self.asset_table_name)
            .select(
                "*, product_model:product_models(*, category:product_categories(*))"
            )
            .order("id")
            .execute()
        )

    @staticmethod
    def flatten_asset(asset: dict[str, Any]) -> dict[str, Any]:
        """Ältere API: verschachtelte model/category-Daten abflachen."""

        flattened = {
            key: value
            for key, value in asset.items()
            if key != "product_model"
        }
        product_model = asset.get("product_model")
        if not isinstance(product_model, dict):
            return flattened

        category = product_model.get("category")
        for key, value in product_model.items():
            if key != "category":
                flattened[f"product_model_{key}"] = value
        if isinstance(category, dict):
            for key, value in category.items():
                flattened[f"product_category_{key}"] = value
        return flattened