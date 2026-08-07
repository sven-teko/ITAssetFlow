from __future__ import annotations

import logging
from typing import Any

from supabase import Client

from inventory import get_asset_identifier, get_inventory_group

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
        """Lädt Einzel-Assets und ergänzt Katalog, Ort, Zuweisung und Einbau."""

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
        self.enrich_current_context(merged_assets)
        return merged_assets, product_categories

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
        """Lädt den berechneten Mengenbestand; noch nicht Teil der Asset-Tabelle."""

        return self._load_rows(
            "stock_levels",
            order_column=None,
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

                manufacturer = manufacturers_by_id.get(model.get("manufacturer_id"))
                if isinstance(manufacturer, dict):
                    asset["manufacturer_name"] = manufacturer.get("name")

            result.append(asset)

        return result

    # ------------------------------------------------------------------
    # Aktueller fachlicher Zustand
    # ------------------------------------------------------------------

    def enrich_current_context(self, assets: list[dict[str, Any]]) -> None:
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
        self._enrich_locations_and_assignments(assets)
        self._enrich_component_assignments(assets)
        self._finalize_usage_state(assets)

    @staticmethod
    def _initialize_usage_fields(assets: list[dict[str, Any]]) -> None:
        for asset in assets:
            asset["current_usage_state"] = "unlocated"
            asset["inventory_usage"] = (
                "Nicht eingebaut"
                if get_inventory_group(asset) == "component"
                else "Nicht zugeordnet"
            )
            asset["installed_in"] = ""
            asset["installed_slot"] = ""
            asset["assigned_to"] = ""
            asset["storage_location"] = ""

    def _enrich_locations_and_assignments(
        self,
        assets: list[dict[str, Any]],
    ) -> None:
        asset_locations = self._load_rows(
            "asset_locations",
            order_column="id",
            required=False,
            select_expression=(
                "id,asset_id,storage_location_id,valid_from,valid_to"
            ),
        )
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
                asset["assigned_department_id"] = department_id

                if employee_id is not None:
                    employee = employees_by_id.get(employee_id)
                    asset["assigned_to"] = self._employee_label(employee, employee_id)
                elif department_id is not None:
                    department = departments_by_id.get(department_id)
                    asset["assigned_to"] = self._department_label(department, department_id)

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
                "id,parent_asset_id,child_asset_id,installed_at,removed_at,slot"
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

            child["current_usage_state"] = "installed"
            child["inventory_usage"] = "Eingebaut"
            child["installed_in_asset_id"] = parent_id
            child["installed_in"] = (
                get_asset_identifier(parent)
                if parent is not None
                else str(parent_id or "")
            )
            child["installed_slot"] = str(row.get("slot") or "")

    @staticmethod
    def _finalize_usage_state(assets: list[dict[str, Any]]) -> None:
        # Absichtlich klein gehalten. Die Methode dient als Erweiterungspunkt
        # für spätere Regeln, ohne MainWindow oder Tabellenwidget anzupassen.
        for asset in assets:
            if asset.get("current_usage_state") == "unlocated":
                asset["inventory_usage"] = (
                    "Nicht eingebaut"
                    if get_inventory_group(asset) == "component"
                    else "Nicht zugeordnet"
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