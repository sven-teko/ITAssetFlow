from __future__ import annotations

from typing import Any, Callable

from PySide6.QtCore import (
    QObject,
    QRunnable,
    QThreadPool,
    Qt,
    QTimer,
    Signal,
    Slot,
)
from PySide6.QtGui import QCloseEvent, QGuiApplication
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QVBoxLayout,
    QWidget,
)
from supabase import Client

from settings_manager import SettingsManager

from .asset_create_dialog import AssetCreateDialog
from .asset_detail_sidebar import AssetDetailSidebar
from .asset_table_widget import AssetTableWidget
from .dock_manager import DockManager
from .inventory_sidebar import InventorySidebar
from .inventory_view_controller import InventoryViewController
from .main_window_menu import MainWindowMenu
from .settings_dialog import SettingsDialog

from inventory import DEFAULT_VISIBLE_COLUMNS, get_asset_identifier


class _TaskSignals(QObject):
    succeeded = Signal(object)
    failed = Signal(str)


class _TaskWorker(QRunnable):
    """Führt eine einzelne Aufgabe im Qt-Threadpool aus."""

    def __init__(
        self,
        task: Callable[[], object],
    ) -> None:
        super().__init__()
        self.task = task
        self.signals = _TaskSignals()

    def run(self) -> None:
        try:
            result = self.task()
        except Exception as exc:
            self.signals.failed.emit(str(exc))
            return

        self.signals.succeeded.emit(result)


class _SettingsService:
    """Supabase-Zugriffe für Datei > Einstellungen.

    Die Stammdaten werden hierarchisch gespeichert:
    Standort -> Abteilung -> Lagerort. Neue Einträge verwenden temporäre
    ``client_key``-Referenzen, damit Standort, Abteilung und Lagerort gemeinsam
    mit einem einzigen Klick auf „Übernehmen“ angelegt werden können.
    """

    def __init__(self, client: Client) -> None:
        self.client = client

    def load(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "sites": self._load_rows(
                "sites",
                "id,name,street,street_number,postal_code,city,country,organization_id",
            ),
            "departments": self._load_rows(
                "departments",
                "id,name,organization_id,site_id",
            ),
            "storage_locations": [
                row
                for row in self._load_rows(
                    "storage_locations",
                    (
                        "id,site_id,department_id,name,parent_location_id,"
                        "location_type,code,is_active"
                    ),
                )
                if bool(row.get("is_active", True))
            ],
            "product_categories": self._load_rows(
                "product_categories",
                "id,name,code,inventory_group,specification_schema",
            ),
            "employees": self._load_rows(
                "employees",
                (
                    "id,employee_number,first_name,last_name,email,"
                    "department_id,is_active,auth_user_id,app_role"
                ),
                order_column="last_name",
            ),
            "manufacturers": self._load_rows(
                "manufacturers",
                "id,name",
            ),
        }

    def save(self, payload: dict[str, Any]) -> dict[str, bool]:
        if not isinstance(payload, dict):
            raise ValueError("Ungültige Einstellungsdaten.")

        # Vor sämtlichen Änderungen prüfen, ob ein zum Löschen markierter
        # Stammdatensatz noch verwendet wird. Dadurch entstehen bei einem
        # fehlgeschlagenen Löschen keine teilweise gespeicherten Änderungen.
        self._validate_deletions(
            payload.get("deleted")
        )

        site_ids = self._save_sites(payload.get("sites"))
        department_ids = self._save_departments(
            payload.get("departments"),
            site_ids,
        )
        self._save_employees(
            payload.get("employees"),
            department_ids,
        )
        self._save_locations(
            payload.get("storage_locations"),
            site_ids,
            department_ids,
        )
        self._save_categories(payload.get("product_categories"))
        self._save_manufacturers(payload.get("manufacturers"))
        self._delete_marked(payload.get("deleted"))
        return {"saved": True}

    def _load_rows(
        self,
        table_name: str,
        select_expression: str,
        *,
        order_column: str = "name",
    ) -> list[dict[str, Any]]:
        response = (
            self.client.table(table_name)
            .select(select_expression)
            .order(order_column)
            .execute()
        )
        data = getattr(response, "data", None)
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

    def _save_sites(self, rows: object) -> dict[str, Any]:
        mapping: dict[str, Any] = {}
        if not isinstance(rows, list):
            return mapping

        default_org = None
        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                raise ValueError("Standortname fehlt.")

            row_id = item.get("id")
            organization_id = item.get("organization_id")
            if organization_id is None:
                if default_org is None:
                    default_org = self._get_default_organization_id()
                organization_id = default_org

            row = {
                "name": name,
                "street": self._none_if_blank(item.get("street")),
                "street_number": self._none_if_blank(item.get("street_number")),
                "postal_code": self._none_if_blank(item.get("postal_code")),
                "city": self._none_if_blank(item.get("city")),
                "country": self._none_if_blank(item.get("country")),
                "organization_id": organization_id,
            }

            if row_id is None:
                response = self.client.table("sites").insert(row).execute()
                row_id = self._inserted_id(response, "Standort")
            else:
                self.client.table("sites").update(row).eq("id", row_id).execute()

            client_key = str(item.get("client_key") or f"id:{row_id}")
            mapping[client_key] = row_id
        return mapping

    def _save_departments(
        self,
        rows: object,
        site_ids: dict[str, Any],
    ) -> dict[str, Any]:
        mapping: dict[str, Any] = {}
        if not isinstance(rows, list):
            return mapping

        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                raise ValueError("Abteilungsname fehlt.")

            site_id = self._resolve_ref(
                item.get("site_ref"),
                site_ids,
                "Standort der Abteilung",
            )
            organization_id = item.get("organization_id")
            if organization_id is None:
                organization_id = self._organization_for_site(site_id)

            row = {
                "name": name,
                "organization_id": organization_id,
                "site_id": site_id,
            }
            row_id = item.get("id")
            if row_id is None:
                response = self.client.table("departments").insert(row).execute()
                row_id = self._inserted_id(response, "Abteilung")
            else:
                self.client.table("departments").update(row).eq("id", row_id).execute()

            client_key = str(item.get("client_key") or f"id:{row_id}")
            mapping[client_key] = row_id
        return mapping

    def _save_locations(
        self,
        rows: object,
        site_ids: dict[str, Any],
        department_ids: dict[str, Any],
    ) -> None:
        if not isinstance(rows, list):
            return

        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                raise ValueError("Lagerortname fehlt.")

            department_id = self._resolve_ref(
                item.get("department_ref"),
                department_ids,
                "Abteilung des Lagerorts",
            )
            site_id = self._resolve_ref(
                item.get("site_ref"),
                site_ids,
                "Standort des Lagerorts",
            )
            location_type = str(item.get("location_type") or "warehouse").strip().casefold()
            if location_type not in {"warehouse", "area", "room"}:
                raise ValueError(f"Lagerort „{name}“ besitzt einen ungültigen Typ.")

            row = {
                "site_id": site_id,
                "department_id": department_id,
                "name": name,
                "parent_location_id": item.get("parent_location_id"),
                "location_type": location_type,
                "code": self._none_if_blank(item.get("code")),
                "is_active": True,
            }
            row_id = item.get("id")
            if row_id is None:
                self.client.table("storage_locations").insert(row).execute()
            else:
                self.client.table("storage_locations").update(row).eq("id", row_id).execute()

    def _save_employees(
        self,
        rows: object,
        department_ids: dict[str, Any],
    ) -> None:
        if not isinstance(rows, list):
            return

        for item in rows:
            if not isinstance(item, dict):
                continue

            first_name = str(
                item.get("first_name")
                or ""
            ).strip()
            last_name = str(
                item.get("last_name")
                or ""
            ).strip()

            if not first_name or not last_name:
                raise ValueError(
                    "Mitarbeiter benötigen Vorname und Nachname."
                )

            department_ref = item.get("department_ref")
            department_id = None
            if str(department_ref or "").strip():
                department_id = self._resolve_ref(
                    department_ref,
                    department_ids,
                    "Abteilung des Mitarbeiters",
                )

            row = {
                "employee_number": self._none_if_blank(
                    item.get("employee_number")
                ),
                "first_name": first_name,
                "last_name": last_name,
                "email": self._none_if_blank(
                    item.get("email")
                ),
                "department_id": department_id,
                "is_active": bool(
                    item.get("is_active", True)
                ),
            }

            row_id = item.get("id")
            if row_id is None:
                # Neue Mitarbeiter erhalten bewusst keine Auth-Verknüpfung.
                # app_role verwendet den DB-Default "user".
                self.client.table("employees").insert(row).execute()
            else:
                # auth_user_id und app_role werden hier absichtlich NICHT
                # verändert. Damit kann das Einstellungsfenster keine
                # Benutzer-/Admin-Verknüpfung beschädigen.
                (
                    self.client.table("employees")
                    .update(row)
                    .eq("id", row_id)
                    .execute()
                )

    def _save_categories(self, rows: object) -> None:
        if not isinstance(rows, list):
            return
        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            code = str(item.get("code") or "").strip()
            if not name or not code:
                raise ValueError("Kategorie benötigt Name und technischen Code.")
            schema = item.get("specification_schema")
            if not isinstance(schema, dict):
                schema = {"fields": []}
            row = {
                "name": name,
                "code": code,
                "inventory_group": str(item.get("inventory_group") or "other").strip().casefold(),
                "specification_schema": schema,
            }
            row_id = item.get("id")
            if row_id is None:
                self.client.table("product_categories").insert(row).execute()
            else:
                self.client.table("product_categories").update(row).eq("id", row_id).execute()

    def _save_manufacturers(self, rows: object) -> None:
        if not isinstance(rows, list):
            return
        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                raise ValueError("Herstellername fehlt.")
            row_id = item.get("id")
            if row_id is None:
                self.client.table("manufacturers").insert({"name": name}).execute()
            else:
                self.client.table("manufacturers").update({"name": name}).eq("id", row_id).execute()

    def _validate_deletions(
        self,
        deleted: object,
    ) -> None:
        """Verhindert das Löschen noch verwendeter Stammdaten.

        Die Supabase-Fremdschlüssel würden diese Löschungen ohnehin ablehnen.
        Die Vorprüfung findet das aber *bevor* andere Einstellungsänderungen
        gespeichert werden und liefert eine verständliche Meldung.
        """

        if not isinstance(deleted, dict):
            return

        checks = {
            # Lagerorte werden beim Entfernen archiviert (is_active = false).
            # Historische Asset-Standorte und Lagerbewegungen dürfen deshalb
            # bestehen bleiben und blockieren das Entfernen nicht.
            "storage_locations": (),
            "departments": (
                ("asset_assignments", "department_id", "Asset-Zuordnungen"),
                ("employees", "department_id", "Mitarbeitende"),
                ("stock_movements", "department_id", "Lagerbewegungen"),
                ("storage_locations", "department_id", "Lagerorte"),
                ("site_departments", "department_id", "Standort-Zuordnungen"),
            ),
            "sites": (
                ("departments", "site_id", "Abteilungen"),
                ("storage_locations", "site_id", "Lagerorte"),
                ("site_departments", "site_id", "Abteilungs-Zuordnungen"),
            ),
            "employees": (
                ("asset_assignments", "employee_id", "Asset-Zuweisungen"),
                ("asset_assignments", "changed_by_employee_id", "Änderungshistorie"),
                ("asset_locations", "changed_by_employee_id", "Standort-Historie"),
                ("software_installations", "recorded_by_employee_id", "Software-Installationen"),
                ("stock_counts", "counted_by_employee_id", "Bestandszählungen"),
                ("stock_movements", "performed_by_employee_id", "Lagerbewegungen"),
            ),
            "product_categories": (
                ("product_models", "category_id", "Produktmodelle"),
            ),
            "manufacturers": (
                ("product_models", "manufacturer_id", "Produktmodelle"),
            ),
        }

        labels = {
            "storage_locations": "Lagerort",
            "departments": "Abteilung",
            "sites": "Standort",
            "employees": "Mitarbeiter",
            "product_categories": "Kategorie",
            "manufacturers": "Hersteller",
        }

        problems: list[str] = []

        for table_name, dependencies in checks.items():
            ids = deleted.get(table_name)
            if not isinstance(ids, list):
                continue

            for row_id in ids:
                if row_id is None:
                    continue

                name = self._row_name(
                    table_name,
                    row_id,
                )

                used_by: list[str] = []

                if table_name == "storage_locations":
                    current_assets = self._current_asset_location_count(row_id)
                    current_stock = self._current_stock_quantity(row_id)
                    child_locations = self._reference_count(
                        "storage_locations",
                        "parent_location_id",
                        row_id,
                    )
                    stock_targets = self._reference_count(
                        "stock_targets",
                        "storage_location_id",
                        row_id,
                    )

                    if current_assets:
                        used_by.append(
                            f"{current_assets} aktuell zugeordnete Asset"
                            + ("" if current_assets == 1 else "s")
                        )
                    if current_stock > 0:
                        used_by.append(
                            f"aktueller Mengenbestand: {current_stock:g}"
                        )
                    if child_locations:
                        used_by.append(
                            f"{child_locations} untergeordnete Lagerorte"
                        )
                    if stock_targets:
                        used_by.append(
                            f"{stock_targets} Bestandsziel"
                            + ("" if stock_targets == 1 else "e")
                        )

                if (
                    table_name == "employees"
                    and self._employee_auth_linked(row_id)
                ):
                    used_by.append("Benutzerkonto / Anmeldung")

                for dependency_table, column, description in dependencies:
                    if self._has_reference(
                        dependency_table,
                        column,
                        row_id,
                    ):
                        if description not in used_by:
                            used_by.append(description)

                if used_by:
                    problems.append(
                        f"{labels.get(table_name, table_name)} "
                        f"„{name}“ kann nicht gelöscht werden "
                        f"(verwendet durch: {', '.join(used_by)})."
                    )

        if problems:
            raise ValueError(
                "Die Änderungen konnten noch nicht übernommen werden.\n\n"
                "Folgende Einträge werden aktuell noch verwendet:\n\n"
                + "\n".join(
                    f"• {problem}"
                    for problem in problems
                )
                + "\n\nBitte ändere zuerst die genannten Zuordnungen "
                "und versuche es danach erneut."
            )

    def _current_asset_location_count(
        self,
        storage_location_id: Any,
    ) -> int:
        response = (
            self.client.table("asset_locations")
            .select("id")
            .eq("storage_location_id", storage_location_id)
            .is_("valid_to", "null")
            .execute()
        )
        data = getattr(response, "data", None)
        return len(data) if isinstance(data, list) else 0

    def _current_stock_quantity(
        self,
        storage_location_id: Any,
    ) -> float:
        response = (
            self.client.table("stock_levels")
            .select("quantity")
            .eq("storage_location_id", storage_location_id)
            .execute()
        )
        data = getattr(response, "data", None)

        total = 0.0
        if isinstance(data, list):
            for row in data:
                if not isinstance(row, dict):
                    continue
                try:
                    total += float(row.get("quantity") or 0)
                except (TypeError, ValueError):
                    continue

        return max(total, 0.0)

    def _reference_count(
        self,
        table_name: str,
        column_name: str,
        row_id: Any,
    ) -> int:
        response = (
            self.client.table(table_name)
            .select(column_name)
            .eq(column_name, row_id)
            .execute()
        )
        data = getattr(response, "data", None)
        return len(data) if isinstance(data, list) else 0

    def _has_reference(
        self,
        table_name: str,
        column_name: str,
        row_id: Any,
    ) -> bool:
        response = (
            self.client
            .table(table_name)
            .select(column_name)
            .eq(column_name, row_id)
            .limit(1)
            .execute()
        )

        data = getattr(
            response,
            "data",
            None,
        )
        return bool(
            isinstance(data, list)
            and data
        )

    def _row_name(
        self,
        table_name: str,
        row_id: Any,
    ) -> str:
        select_expression = (
            "first_name,last_name"
            if table_name == "employees"
            else "name"
        )

        response = (
            self.client
            .table(table_name)
            .select(select_expression)
            .eq("id", row_id)
            .limit(1)
            .execute()
        )
        data = getattr(
            response,
            "data",
            None,
        )

        if (
            isinstance(data, list)
            and data
            and isinstance(data[0], dict)
        ):
            if table_name == "employees":
                name = " ".join(
                    part
                    for part in (
                        str(data[0].get("first_name") or "").strip(),
                        str(data[0].get("last_name") or "").strip(),
                    )
                    if part
                )
            else:
                name = str(
                    data[0].get("name")
                    or ""
                ).strip()

            if name:
                return name

        return f"ID {row_id}"

    def _employee_auth_linked(
        self,
        employee_id: Any,
    ) -> bool:
        response = (
            self.client.table("employees")
            .select("auth_user_id")
            .eq("id", employee_id)
            .limit(1)
            .execute()
        )
        data = getattr(response, "data", None)
        return bool(
            isinstance(data, list)
            and data
            and isinstance(data[0], dict)
            and data[0].get("auth_user_id") is not None
        )

    def _delete_marked(self, deleted: object) -> None:
        if not isinstance(deleted, dict):
            return
        # Von unten nach oben löschen: Lagerort -> Abteilung -> Standort.
        for table_name in (
            "storage_locations",
            "employees",
            "departments",
            "sites",
            "product_categories",
            "manufacturers",
        ):
            ids = deleted.get(table_name)
            if not isinstance(ids, list):
                continue
            for row_id in ids:
                if row_id is None:
                    continue

                if table_name == "storage_locations":
                    # Lagerorte enthalten Historie über asset_locations und
                    # stock_movements. Deshalb fachlich "löschen", technisch
                    # aber archivieren. So bleibt die Historie vollständig.
                    (
                        self.client.table("storage_locations")
                        .update({"is_active": False})
                        .eq("id", row_id)
                        .execute()
                    )
                    continue

                self.client.table(table_name).delete().eq("id", row_id).execute()

    @staticmethod
    def _none_if_blank(value: Any) -> Any | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _inserted_id(response: object, label: str) -> Any:
        data = getattr(response, "data", None)
        rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        if not rows or rows[0].get("id") is None:
            raise RuntimeError(f"Supabase hat für {label} keine ID zurückgegeben.")
        return rows[0]["id"]

    @staticmethod
    def _resolve_ref(ref: Any, mapping: dict[str, Any], label: str) -> Any:
        key = str(ref or "").strip()
        if not key:
            raise ValueError(f"{label} fehlt.")
        if key in mapping:
            return mapping[key]
        if key.startswith("id:"):
            raw = key[3:]
            try:
                return int(raw)
            except ValueError:
                return raw
        raise ValueError(f"{label} konnte nicht aufgelöst werden.")

    def _organization_for_site(self, site_id: Any) -> Any:
        response = (
            self.client.table("sites")
            .select("organization_id")
            .eq("id", site_id)
            .limit(1)
            .execute()
        )
        data = getattr(response, "data", None)
        rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        if rows and rows[0].get("organization_id") is not None:
            return rows[0]["organization_id"]
        return self._get_default_organization_id()

    def _get_default_organization_id(self) -> Any:
        response = (
            self.client.table("organizations")
            .select("id")
            .order("id")
            .limit(1)
            .execute()
        )
        data = getattr(response, "data", None)
        rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        if not rows or rows[0].get("id") is None:
            raise RuntimeError("Es ist keine Organisation vorhanden.")
        return rows[0]["id"]


class MainWindow(QMainWindow):
    """Hauptfenster von ITAssetFlow.

    MainWindow übernimmt nur noch die Koordination der UI-Komponenten.

    Ausgelagerte Verantwortlichkeiten:
    - Docking/Floating: DockManager
    - Menüleiste und Actions: MainWindowMenu
    - Inventar laden/Refresh/Cloud-Monitor: InventoryViewController
    """

    DEFAULT_WIDTH = 1200
    DEFAULT_HEIGHT = 750
    ASSET_TABLE_NAME = "assets"

    def __init__(
        self,
        supabase_client: Client,
        authenticated_email: str,
    ) -> None:
        super().__init__()

        self.supabase_client = supabase_client
        self.authenticated_email = authenticated_email
        self.settings_manager = SettingsManager()

        self.assets: list[dict[str, Any]] = []
        self._create_dialog: AssetCreateDialog | None = None
        self._edit_dialog: AssetCreateDialog | None = None
        self._settings_dialog: SettingsDialog | None = None

        self._settings_service = _SettingsService(
            self.supabase_client
        )
        self._thread_pool = QThreadPool.globalInstance()
        self._settings_busy = False
        self._pending_default_columns: list[str] | None = None
        self._default_columns_applied = False

        self.setWindowTitle("ITAssetFlow")
        self.resize(
            self.DEFAULT_WIDTH,
            self.DEFAULT_HEIGHT,
        )

        self._create_menu()
        self._create_central_area()
        self._create_sidebars()
        self._create_dock_manager()
        self._create_inventory_controller()
        self._create_status_bar()

        self._connect_signals()
        self._restore_window_settings()

        QTimer.singleShot(
            0,
            self.inventory_controller.start,
        )

    # ------------------------------------------------------------------
    # UI-Aufbau
    # ------------------------------------------------------------------

    def _create_menu(self) -> None:
        self.menu_controller = MainWindowMenu(
            self,
        )

    def _create_central_area(self) -> None:
        central_widget = QWidget(self)

        layout = QVBoxLayout(
            central_widget
        )
        layout.setContentsMargins(
            20,
            18,
            20,
            20,
        )
        layout.setSpacing(12)

        header = QHBoxLayout()

        title = QLabel("IT-Inventar")
        title.setObjectName("pageTitle")

        self.record_count_label = QLabel(
            "Keine Daten geladen"
        )
        self.record_count_label.setObjectName(
            "recordCountLabel"
        )
        self.record_count_label.setAlignment(
            Qt.AlignmentFlag.AlignRight
            | Qt.AlignmentFlag.AlignVCenter
        )

        header.addWidget(title)
        header.addStretch()
        header.addWidget(
            self.record_count_label
        )

        self.asset_table = AssetTableWidget(
            self.menu_controller.columns_menu,
            self,
        )

        layout.addLayout(header)
        layout.addWidget(
            self.asset_table
        )

        self.setCentralWidget(
            central_widget
        )

    def _create_sidebars(self) -> None:
        # MainWindow definiert den eindeutigen Standardaufbau:
        # Navigation links, Detailansicht rechts.
        self.sidebar = InventorySidebar(
            self
        )
        self.detail_sidebar = AssetDetailSidebar(
            self
        )

        self.addDockWidget(
            Qt.DockWidgetArea.LeftDockWidgetArea,
            self.sidebar,
        )
        self.addDockWidget(
            Qt.DockWidgetArea.RightDockWidgetArea,
            self.detail_sidebar,
        )

        self.sidebar.show()
        self.detail_sidebar.show()

    def _create_dock_manager(self) -> None:
        self.dock_manager = DockManager(
            main_window=self,
            navigation=self.sidebar,
            detail=self.detail_sidebar,
        )

    def _create_inventory_controller(self) -> None:
        self.inventory_controller = (
            InventoryViewController(
                self.supabase_client,
                asset_table_name=self.ASSET_TABLE_NAME,
                parent=self,
            )
        )

    def _create_status_bar(self) -> None:
        self.statusBar().showMessage(
            "Bereit"
        )

        user_label = QLabel(
            f"Angemeldet: {self.authenticated_email}"
        )
        user_label.setObjectName(
            "userStatusLabel"
        )

        self.statusBar().addPermanentWidget(
            user_label
        )

    # ------------------------------------------------------------------
    # Signal-Verbindungen
    # ------------------------------------------------------------------

    def _connect_signals(self) -> None:
        self._connect_table_signals()
        self._connect_sidebar_signals()
        self._connect_menu_signals()
        self._connect_dock_signals()
        self._connect_inventory_signals()

    def _connect_table_signals(self) -> None:
        self.asset_table.itemSelectionChanged.connect(
            self._selection_changed
        )
        self.asset_table.counts_changed.connect(
            self._update_count_labels
        )
        self.asset_table.visible_columns_changed.connect(
            self.apply_filter
        )
        self.asset_table.column_visibility_rejected.connect(
            self._show_short_status
        )

    def _connect_sidebar_signals(self) -> None:
        self.sidebar.filter_changed.connect(
            self.apply_filter
        )

        self.sidebar.create_requested.connect(
            self.show_create_asset_dialog
        )
        self.sidebar.edit_requested.connect(
            self.show_edit_asset_dialog
        )
        self.sidebar.delete_requested.connect(
            self.show_delete_assets_dialog
        )

    def _connect_menu_signals(self) -> None:
        menu = self.menu_controller

        menu.refresh_requested.connect(
            self.inventory_controller.load_inventory
        )
        menu.settings_requested.connect(
            self.show_settings_dialog
        )
        menu.exit_requested.connect(
            self.close
        )
        menu.about_requested.connect(
            self.show_about_dialog
        )

        menu.navigation_visibility_requested.connect(
            self.dock_manager.set_navigation_visible
        )
        menu.navigation_left_requested.connect(
            self.dock_manager.dock_navigation_left
        )
        menu.navigation_right_requested.connect(
            self.dock_manager.dock_navigation_right
        )
        menu.navigation_float_requested.connect(
            self.dock_manager.float_navigation
        )

        menu.detail_visibility_requested.connect(
            self.dock_manager.set_detail_visible
        )
        menu.detail_left_requested.connect(
            self.dock_manager.dock_detail_left
        )
        menu.detail_right_requested.connect(
            self.dock_manager.dock_detail_right
        )
        menu.detail_float_requested.connect(
            self.dock_manager.float_detail
        )

    def _connect_dock_signals(self) -> None:
        self.dock_manager.navigation_visibility_changed.connect(
            self.menu_controller.set_navigation_visible_checked
        )
        self.dock_manager.detail_visibility_changed.connect(
            self.menu_controller.set_detail_visible_checked
        )

        self.dock_manager.navigation_floating_changed.connect(
            self.menu_controller.set_navigation_floating
        )
        self.dock_manager.detail_floating_changed.connect(
            self.menu_controller.set_detail_floating
        )

        # Anfangszustand auch ohne vorherige Signaländerung korrekt setzen.
        self.menu_controller.set_navigation_visible_checked(
            self.sidebar.isVisible()
        )
        self.menu_controller.set_detail_visible_checked(
            self.detail_sidebar.isVisible()
        )
        self.menu_controller.set_navigation_floating(
            self.sidebar.isFloating()
        )
        self.menu_controller.set_detail_floating(
            self.detail_sidebar.isFloating()
        )

    def _connect_inventory_signals(self) -> None:
        controller = self.inventory_controller

        controller.inventory_loaded.connect(
            self._inventory_loaded
        )
        controller.loading_changed.connect(
            self._set_loading_state
        )
        controller.load_failed.connect(
            self._inventory_load_failed
        )
        controller.status_message.connect(
            self._show_status_message
        )
        controller.create_form_loaded.connect(
            self._open_create_asset_dialog
        )
        controller.create_form_failed.connect(
            self._create_form_failed
        )
        controller.entry_created.connect(
            self._entry_created
        )
        controller.entry_create_failed.connect(
            self._entry_create_failed
        )
        controller.edit_form_loaded.connect(
            self._open_edit_asset_dialog
        )
        controller.edit_form_failed.connect(
            self._edit_form_failed
        )
        controller.entry_updated.connect(
            self._entry_updated
        )
        controller.entry_update_failed.connect(
            self._entry_update_failed
        )
        controller.entries_deleted.connect(
            self._entries_deleted
        )
        controller.entries_delete_failed.connect(
            self._entries_delete_failed
        )
        controller.writing_changed.connect(
            self._set_writing_state
        )

    # ------------------------------------------------------------------
    # Inventardaten / Filter / Auswahl
    # ------------------------------------------------------------------

    @Slot(object)
    def _inventory_loaded(self, assets: object) -> None:
        self.assets = (
            [row for row in assets if isinstance(row, dict)]
            if isinstance(assets, list)
            else []
        )

        self.sidebar.rebuild_filters(self.assets)
        self.asset_table.populate_assets(self.assets)

        if not self._default_columns_applied:
            self._apply_default_columns(
                self._load_default_columns()
            )
            self._default_columns_applied = True

        self.apply_filter()
        self._selection_changed()

    @Slot(str)
    def _inventory_load_failed(
        self,
        message: str,
    ) -> None:
        self.assets = []

        self.sidebar.rebuild_filters([])
        self.sidebar.set_selection([])
        self.asset_table.clear_assets()
        self.detail_sidebar.set_assets([])

        QMessageBox.critical(
            self,
            "Supabase-Fehler",
            message,
        )

    @Slot()
    def apply_filter(self) -> None:
        self.asset_table.filter_rows(
            self.sidebar.search_text,
            self.sidebar.matches,
        )
        self._selection_changed()

    @Slot()
    def _selection_changed(self) -> None:
        selected_assets = (
            self.asset_table.get_selected_assets()
        )

        self.sidebar.set_selection(
            [
                get_asset_identifier(asset)
                for asset in selected_assets
            ]
        )

        self.detail_sidebar.set_assets(
            selected_assets
        )

    @Slot(int, int)
    def _update_count_labels(
        self,
        visible: int,
        total: int,
    ) -> None:
        text = (
            f"{total} Datensätze"
            if visible == total
            else f"{visible} von {total} Datensätzen"
        )

        self.record_count_label.setText(
            text
        )
        self.sidebar.set_count_text(
            text
        )

    @Slot(bool)
    def _set_loading_state(
        self,
        _loading: bool,
    ) -> None:
        self._sync_busy_state()

    @Slot(bool)
    def _set_writing_state(
        self,
        _writing: bool,
    ) -> None:
        self._sync_busy_state()

    def _sync_busy_state(self) -> None:
        busy = (
            self.inventory_controller.is_loading
            or self.inventory_controller.is_writing
            or self._settings_busy
        )
        self.menu_controller.set_loading_state(busy)
        self.sidebar.set_loading_state(busy)

    def notify_inventory_changed(self) -> None:
        """Nach erfolgreichem Create/Edit/Delete aufrufen."""

        self.inventory_controller.notify_inventory_changed()

    # ------------------------------------------------------------------
    # Statusmeldungen
    # ------------------------------------------------------------------

    @Slot(str, int)
    def _show_status_message(
        self,
        message: str,
        timeout_ms: int,
    ) -> None:
        self.statusBar().showMessage(
            message,
            timeout_ms,
        )

    @Slot(str)
    def _show_short_status(
        self,
        message: str,
    ) -> None:
        self.statusBar().showMessage(
            message,
            3000,
        )

    # ------------------------------------------------------------------
    # Einstellungen
    # ------------------------------------------------------------------

    @Slot()
    def show_settings_dialog(self) -> None:
        """Öffnet Datei > Einstellungen."""

        if self._settings_dialog is not None:
            self._settings_dialog.raise_()
            self._settings_dialog.activateWindow()
            return

        if self._settings_busy:
            return

        self._set_settings_busy(True)
        self.statusBar().showMessage(
            "Einstellungen werden geladen ...",
            0,
        )

        worker = _TaskWorker(
            self._settings_service.load
        )
        worker.signals.succeeded.connect(
            self._settings_data_loaded
        )
        worker.signals.failed.connect(
            self._settings_data_failed
        )
        self._thread_pool.start(
            worker
        )

    @Slot(object)
    def _settings_data_loaded(
        self,
        data: object,
    ) -> None:
        self._set_settings_busy(False)

        if not isinstance(data, dict):
            self._settings_data_failed(
                "Die geladenen Einstellungsdaten sind ungültig."
            )
            return

        dialog_data = dict(
            data
        )
        dialog_data["default_visible_columns"] = sorted(
            self._load_default_columns()
        )

        dialog = SettingsDialog(
            dialog_data,
            self,
        )
        self._settings_dialog = dialog

        dialog.submit_requested.connect(
            self._submit_settings
        )

        self.statusBar().showMessage(
            "Einstellungen bereit.",
            2500,
        )

        try:
            dialog.exec()
        finally:
            self._settings_dialog = None
            self._pending_default_columns = None

    @Slot(str)
    def _settings_data_failed(
        self,
        message: str,
    ) -> None:
        self._set_settings_busy(False)

        self.statusBar().showMessage(
            "Einstellungen konnten nicht geladen werden.",
            5000,
        )

        QMessageBox.critical(
            self,
            "Einstellungen",
            (
                "Die Einstellungen konnten nicht geladen werden.\n\n"
                f"{message}"
            ),
        )

    @Slot(object)
    def _submit_settings(
        self,
        payload: object,
    ) -> None:
        if not isinstance(payload, dict):
            if self._settings_dialog is not None:
                self._settings_dialog.set_saving(False)
            return

        if self._settings_busy:
            return

        columns = payload.get(
            "default_visible_columns"
        )
        self._pending_default_columns = (
            [
                str(column)
                for column in columns
                if str(column).strip()
            ]
            if isinstance(columns, list)
            else None
        )

        database_payload = dict(
            payload
        )
        database_payload.pop(
            "default_visible_columns",
            None,
        )

        self._set_settings_busy(True)
        self.statusBar().showMessage(
            "Einstellungen werden gespeichert ...",
            0,
        )

        worker = _TaskWorker(
            lambda: self._settings_service.save(
                database_payload
            )
        )
        worker.signals.succeeded.connect(
            self._settings_saved
        )
        worker.signals.failed.connect(
            self._settings_save_failed
        )
        self._thread_pool.start(
            worker
        )

    @Slot(object)
    def _settings_saved(
        self,
        _result: object,
    ) -> None:
        self._set_settings_busy(False)

        if self._pending_default_columns:
            self._save_default_columns(
                self._pending_default_columns
            )
            self._apply_default_columns(
                self._pending_default_columns
            )

        if self._settings_dialog is not None:
            self._settings_dialog.set_saving(False)
            self._settings_dialog.accept()

        self.statusBar().showMessage(
            "Einstellungen wurden übernommen.",
            5000,
        )

        # Kategorien, Lagerorte oder Abteilungen können sich geändert haben.
        self.inventory_controller.notify_inventory_changed()

    @Slot(str)
    def _settings_save_failed(
        self,
        message: str,
    ) -> None:
        self._set_settings_busy(False)

        if self._settings_dialog is not None:
            self._settings_dialog.set_saving(False)

        self.statusBar().showMessage(
            "Einstellungen konnten nicht gespeichert werden.",
            6000,
        )

        QMessageBox.critical(
            self._settings_dialog or self,
            "Einstellungen konnten nicht gespeichert werden",
            message,
        )

    def _set_settings_busy(
        self,
        busy: bool,
    ) -> None:
        self._settings_busy = busy
        self._sync_busy_state()

    # ------------------------------------------------------------------
    # Lokale Standardansicht der Spalten
    # ------------------------------------------------------------------

    def _load_default_columns(
        self,
    ) -> set[str]:
        value = self.settings_manager.settings.value(
            "table/default_visible_columns",
            None,
        )

        if isinstance(
            value,
            (list, tuple),
        ):
            columns = {
                str(column)
                for column in value
                if str(column).strip()
            }

            # Einmalige Migration für die neu eingeführte Spalte „Standort“.
            # So erscheint sie auch bei Benutzern, die bereits eine
            # Standardspalten-Auswahl gespeichert haben. Danach kann sie
            # ganz normal wieder ausgeblendet werden.
            migrated = self.settings_manager.settings.value(
                "table/site_name_column_migrated",
                False,
                type=bool,
            )
            if not migrated:
                columns.add("site_name")
                self.settings_manager.settings.setValue(
                    "table/default_visible_columns",
                    list(columns),
                )
                self.settings_manager.settings.setValue(
                    "table/site_name_column_migrated",
                    True,
                )

            if columns:
                return columns

        return set(
            DEFAULT_VISIBLE_COLUMNS
        )

    def _save_default_columns(
        self,
        columns: list[str],
    ) -> None:
        self.settings_manager.settings.setValue(
            "table/default_visible_columns",
            list(columns),
        )

    def _apply_default_columns(
        self,
        columns: set[str] | list[str],
    ) -> None:
        """Speichert und aktiviert die konfigurierte Standardansicht."""

        setter = getattr(
            self.asset_table,
            "set_default_visible_columns",
            None,
        )
        if callable(setter):
            setter(
                columns,
                apply_now=True,
            )
            return

        # Fallback für eine ältere AssetTableWidget-Version.
        current_columns = list(
            getattr(
                self.asset_table,
                "current_columns",
                [],
            )
        )
        if not current_columns:
            return

        available = set(current_columns)
        selected = {
            str(column)
            for column in columns
            if str(column) in available
        }
        if not selected:
            selected = set(current_columns[:5])

        self.asset_table.visible_columns = selected
        self.asset_table.sync_column_actions()
        self.asset_table.apply_column_visibility()
        self.asset_table.resize_visible_columns()
        self.asset_table.visible_columns_changed.emit()

    # ------------------------------------------------------------------
    # Schreibaktionen – derzeit noch Platzhalter
    # ------------------------------------------------------------------

    @Slot()
    def show_create_asset_dialog(self) -> None:
        """Lädt die Stammdaten und öffnet danach den Eingabedialog."""

        if self._create_dialog is not None:
            self._create_dialog.raise_()
            self._create_dialog.activateWindow()
            return

        self.inventory_controller.load_create_form_data()

    @Slot(object)
    def _open_create_asset_dialog(self, data: object) -> None:
        if not isinstance(data, dict):
            QMessageBox.critical(
                self,
                "Neuer Eintrag",
                "Die Stammdaten für das Eingabefenster sind ungültig.",
            )
            return

        dialog = AssetCreateDialog(data, self)
        self._create_dialog = dialog
        dialog.submit_requested.connect(
            self.inventory_controller.create_inventory_entry
        )

        try:
            dialog.exec()
        finally:
            self._create_dialog = None

    @Slot(str)
    def _create_form_failed(self, message: str) -> None:
        QMessageBox.critical(
            self,
            "Neuer Eintrag",
            (
                "Die Daten für das Eingabefenster konnten nicht geladen werden.\n\n"
                f"{message}"
            ),
        )

    @Slot(object)
    def _entry_created(self, result: object) -> None:
        if self._create_dialog is not None:
            self._create_dialog.set_saving(False)
            self._create_dialog.accept()

        if isinstance(result, dict):
            if result.get("entry_type") == "asset":
                identifier = result.get("asset_tag") or result.get("id")
                self.statusBar().showMessage(
                    f"Asset {identifier} wurde angelegt.",
                    5000,
                )
            else:
                self.statusBar().showMessage(
                    "Mengenbestand wurde eingebucht.",
                    5000,
                )

    @Slot(str)
    def _entry_create_failed(self, message: str) -> None:
        if self._create_dialog is not None:
            self._create_dialog.set_saving(False)

        QMessageBox.critical(
            self._create_dialog or self,
            "Eintrag konnte nicht gespeichert werden",
            message,
        )

    @Slot()
    def show_edit_asset_dialog(self) -> None:
        entry = self.asset_table.get_selected_asset()

        if entry is None:
            QMessageBox.information(
                self,
                "Eintrag bearbeiten",
                "Bitte genau einen Eintrag auswählen.",
            )
            return

        if self._edit_dialog is not None:
            self._edit_dialog.raise_()
            self._edit_dialog.activateWindow()
            return

        self.inventory_controller.load_edit_form_data(
            entry
        )

    @Slot(object)
    def _open_edit_asset_dialog(
        self,
        data: object,
    ) -> None:
        if not isinstance(data, dict):
            QMessageBox.critical(
                self,
                "Eintrag bearbeiten",
                "Die Daten für das Bearbeitungsfenster sind ungültig.",
            )
            return

        edit_entry = data.get("edit_entry")
        if not isinstance(edit_entry, dict):
            QMessageBox.critical(
                self,
                "Eintrag bearbeiten",
                "Der ausgewählte Inventareintrag konnte nicht geladen werden.",
            )
            return

        dialog = AssetCreateDialog(
            data,
            self,
            edit_entry=edit_entry,
        )
        self._edit_dialog = dialog
        dialog.submit_requested.connect(
            self.inventory_controller.update_inventory_entry
        )

        try:
            dialog.exec()
        finally:
            self._edit_dialog = None

    @Slot(str)
    def _edit_form_failed(
        self,
        message: str,
    ) -> None:
        QMessageBox.critical(
            self,
            "Eintrag bearbeiten",
            (
                "Die Daten für das Bearbeitungsfenster "
                "konnten nicht geladen werden.\n\n"
                f"{message}"
            ),
        )

    @Slot(object)
    def _entry_updated(
        self,
        result: object,
    ) -> None:
        if self._edit_dialog is not None:
            self._edit_dialog.set_saving(False)
            self._edit_dialog.accept()

        if isinstance(result, dict):
            if result.get("entry_type") == "asset":
                identifier = (
                    result.get("asset_tag")
                    or result.get("id")
                )
                self.statusBar().showMessage(
                    f"Asset {identifier} wurde aktualisiert.",
                    5000,
                )
            else:
                self.statusBar().showMessage(
                    "Mengenbestand wurde aktualisiert.",
                    5000,
                )

    @Slot(str)
    def _entry_update_failed(
        self,
        message: str,
    ) -> None:
        if self._edit_dialog is not None:
            self._edit_dialog.set_saving(False)

        QMessageBox.critical(
            self._edit_dialog or self,
            "Eintrag konnte nicht aktualisiert werden",
            message,
        )

    @Slot()
    def show_delete_assets_dialog(self) -> None:
        assets = self.asset_table.get_selected_assets()

        if not assets:
            QMessageBox.information(
                self,
                "Einträge löschen",
                "Bitte zuerst mindestens einen Eintrag auswählen.",
            )
            return

        identifiers = [
            get_asset_identifier(asset)
            for asset in assets[:8]
        ]
        preview = "\n".join(
            f"• {identifier}"
            for identifier in identifiers
        )

        if len(assets) > 8:
            preview += (
                f"\n• … und {len(assets) - 8} weitere"
            )

        stock_count = sum(
            1
            for asset in assets
            if str(
                asset.get("_record_type")
                or ""
            ).strip().casefold()
            == "stock"
        )
        asset_count = len(assets) - stock_count

        details: list[str] = []
        if asset_count:
            details.append(
                (
                    f"{asset_count} Einzelartikel wird endgültig gelöscht."
                    if asset_count == 1
                    else f"{asset_count} Einzelartikel werden endgültig gelöscht."
                )
            )
        if stock_count:
            details.append(
                (
                    f"{stock_count} Mengenbestand wird vollständig ausgebucht."
                    if stock_count == 1
                    else f"{stock_count} Mengenbestände werden vollständig ausgebucht."
                )
            )

        dialog = QMessageBox(self)
        dialog.setWindowTitle("Löschen bestätigen")
        dialog.setIcon(QMessageBox.Icon.Warning)
        dialog.setText(
            "<b>Wirklich löschen?</b>"
        )
        dialog.setInformativeText(
            "\n".join(details)
            + "\n\n"
            + preview
            + "\n\nDieser Vorgang kann nicht rückgängig gemacht werden."
        )
        dialog.setStandardButtons(
            QMessageBox.StandardButton.Yes
            | QMessageBox.StandardButton.Cancel
        )
        dialog.setDefaultButton(
            QMessageBox.StandardButton.Cancel
        )

        delete_button = dialog.button(
            QMessageBox.StandardButton.Yes
        )
        if delete_button is not None:
            delete_button.setText("Löschen")

        cancel_button = dialog.button(
            QMessageBox.StandardButton.Cancel
        )
        if cancel_button is not None:
            cancel_button.setText("Abbrechen")

        if (
            dialog.exec()
            != QMessageBox.StandardButton.Yes
        ):
            return

        self.inventory_controller.delete_inventory_entries(
            assets
        )

    @Slot(object)
    def _entries_deleted(
        self,
        result: object,
    ) -> None:
        deleted_count = 0
        asset_count = 0
        stock_count = 0

        if isinstance(result, dict):
            deleted_count = int(
                result.get("deleted_count")
                or 0
            )
            asset_count = int(
                result.get("asset_count")
                or 0
            )
            stock_count = int(
                result.get("stock_count")
                or 0
            )

        self.asset_table.clearSelection()
        self._selection_changed()

        if deleted_count <= 0:
            self.statusBar().showMessage(
                "Die ausgewählten Einträge waren bereits nicht mehr vorhanden.",
                5000,
            )
            return

        parts: list[str] = []
        if asset_count:
            parts.append(
                (
                    f"{asset_count} Einzelartikel gelöscht"
                    if asset_count != 1
                    else "1 Einzelartikel gelöscht"
                )
            )
        if stock_count:
            parts.append(
                (
                    f"{stock_count} Mengenbestände ausgebucht"
                    if stock_count != 1
                    else "1 Mengenbestand ausgebucht"
                )
            )

        self.statusBar().showMessage(
            " · ".join(parts)
            if parts
            else f"{deleted_count} Einträge gelöscht.",
            5000,
        )

    @Slot(str)
    def _entries_delete_failed(
        self,
        message: str,
    ) -> None:
        QMessageBox.critical(
            self,
            "Einträge konnten nicht gelöscht werden",
            message,
        )

    # ------------------------------------------------------------------
    # Hilfe
    # ------------------------------------------------------------------

    @Slot()
    def show_about_dialog(self) -> None:
        dialog = QMessageBox(
            self
        )
        dialog.setWindowTitle(
            "Über"
        )
        dialog.setIcon(
            QMessageBox.Icon.Information
        )
        dialog.setText(
            "<h2>ITAssetFlow</h2>"
            "<p>Inventarverwaltung für IT-Materialien.</p>"
            "<p>Datenbank und Authentifizierung über Supabase.</p>"
            "<p>DLC-Informatik GmbH</p>"
        )
        dialog.setStandardButtons(
            QMessageBox.StandardButton.Ok
        )
        dialog.exec()

    # ------------------------------------------------------------------
    # Fensterzustand
    # ------------------------------------------------------------------

    def _restore_window_settings(self) -> None:
        geometry = (
            self.settings_manager.load_window_geometry()
        )

        if geometry:
            self.restoreGeometry(geometry)

        state = self.settings_manager.load_window_state()
        if state:
            self.restoreState(state)

        if not self._is_on_available_screen():
            self._move_to_primary_screen()

        if self.settings_manager.load_window_maximized():
            self.showMaximized()

    def _is_on_available_screen(self) -> bool:
        geometry = self.frameGeometry()

        return any(
            screen.availableGeometry().intersects(
                geometry
            )
            for screen in QGuiApplication.screens()
        )

    def _move_to_primary_screen(self) -> None:
        screen = (
            QGuiApplication.primaryScreen()
        )

        if screen is None:
            return

        self.resize(
            self.DEFAULT_WIDTH,
            self.DEFAULT_HEIGHT,
        )

        geometry = (
            screen.availableGeometry()
        )

        self.move(
            geometry.x()
            + (
                geometry.width()
                - self.width()
            )
            // 2,
            geometry.y()
            + (
                geometry.height()
                - self.height()
            )
            // 2,
        )

    # ------------------------------------------------------------------
    # Beenden
    # ------------------------------------------------------------------

    def closeEvent(
        self,
        event: QCloseEvent,
    ) -> None:
        self.inventory_controller.stop()

        self.settings_manager.save_window_geometry(
            self.saveGeometry()
        )
        self.settings_manager.save_window_state(
            self.saveState()
        )
        self.settings_manager.save_window_maximized(
            self.isMaximized()
        )

        super().closeEvent(event)