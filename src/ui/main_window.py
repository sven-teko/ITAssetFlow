from __future__ import annotations

import json
import logging
from typing import Any

from PySide6.QtCore import Qt, QTimer, Slot
from PySide6.QtGui import QAction, QCloseEvent, QGuiApplication
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QDockWidget,
    QGroupBox,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMenu,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)
from supabase import Client

from settings_manager import SettingsManager


logger = logging.getLogger(__name__)


class MainWindow(QMainWindow):
    DEFAULT_WIDTH = 1200
    DEFAULT_HEIGHT = 750

    ASSET_TABLE_NAME = "assets"

    # Übergangslösung für die Gruppierung. Langfristig sollte diese
    # Information als Feld in product_categories gespeichert werden.
    DEVICE_CATEGORY_CODES = {
        "barcode_scanner",
        "desktop_pc",
        "laptop",
        "lcd_display",
        "network_switch",
        "phone",
        "pos_terminal",
        "printer",
        "restaurant_pager",
        "router",
        "server",
        "stereo_system",
        "surveillance_camera",
        "tablet",
        "wifi_extender",
    }

    PERIPHERAL_CATEGORY_CODES = {
        "cable",
        "headset",
        "keyboard",
        "lamp",
        "monitor",
        "mouse",
        "power_adapter",
    }

    COMPONENT_CATEGORY_CODES = {
        "cpu",
        "memory",
        "ram",
        "motherboard",
        "power_supply",
        "storage_drive",
    }

    CATEGORY_LABELS = {
        "barcode_scanner": "Barcodescanner",
        "cable": "Kabel",
        "cpu": "Prozessoren",
        "desktop_pc": "Computer",
        "headset": "Headsets",
        "keyboard": "Tastaturen",
        "lamp": "Lampen",
        "laptop": "Notebooks",
        "lcd_display": "LCD-Anzeigen",
        "memory": "Arbeitsspeicher",
        "ram": "Arbeitsspeicher",
        "monitor": "Monitore",
        "motherboard": "Mainboards",
        "mouse": "Mäuse",
        "network_switch": "Switches",
        "phone": "Telefone",
        "pos_terminal": "Kassen",
        "power_adapter": "Stromadapter",
        "power_supply": "Netzteile",
        "printer": "Drucker",
        "restaurant_pager": "Restaurant-Pager",
        "router": "Router",
        "server": "Server",
        "stereo_system": "Stereoanlagen",
        "storage_drive": "Datenträger",
        "surveillance_camera": "Überwachungskameras",
        "tablet": "Tablets",
        "wifi_extender": "WLAN-Extender",
    }

    PREFERRED_COLUMN_ORDER = [
        "id",
        "asset_tag",
        "name",
        "inventory_number",
        "hostname",
        "serial_number",
        "product_model_name",
        "product_model_model_name",
        "product_category_name",
        "product_category_code",
        "inventory_usage",
        "installed_in",
        "product_model_tracking_mode",
        "product_model_id",
        "status",
        "condition",
        "purchase_date",
        "warranty_end",
        "notes",
        "created_at",
        "updated_at",
    ]

    DEFAULT_VISIBLE_COLUMNS = {
        "asset_tag",
        "name",
        "inventory_number",
        "hostname",
        "serial_number",
        "product_model_name",
        "product_model_model_name",
        "product_category_name",
        "inventory_usage",
        "installed_in",
        "status",
    }

    HEADER_LABELS = {
        "id": "ID",
        "asset_tag": "Asset-Tag",
        "name": "Name",
        "inventory_number": "Inventarnummer",
        "hostname": "Hostname",
        "serial_number": "Seriennummer",
        "product_model_id": "Produktmodell-ID",
        "product_model_name": "Produktmodell",
        "product_model_model_name": "Produktmodell",
        "product_model_description": "Modellbeschreibung",
        "product_model_manufacturer_id": "Hersteller-ID",
        "product_model_category_id": "Kategorie-ID",
        "product_category_id": "Kategorie-ID",
        "product_category_name": "Produktkategorie",
        "product_category_code": "Kategoriecode",
        "product_category_inventory_group": "Inventartyp",
        "product_model_tracking_mode": "Bestandsführung",
        "inventory_usage": "Verwendung",
        "installed_in": "Eingebaut in",
        "installed_in_asset_id": "Eltern-Asset-ID",
        "status": "Status",
        "condition": "Zustand",
        "purchase_date": "Kaufdatum",
        "warranty_end": "Garantie bis",
        "notes": "Bemerkungen",
        "created_at": "Erstellt am",
        "updated_at": "Geändert am",
    }

    NAME_FIELDS = (
        "name",
        "asset_name",
        "hostname",
        "product_model_name",
        "product_model_model_name",
    )

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
        self.current_columns: list[str] = []
        self.column_actions: dict[str, QAction] = {}

        self.visible_columns: set[str] = set()
        self.column_visibility_initialized = False
        self.category_checkboxes: dict[str, QCheckBox] = {}
        self.is_loading = False

        self.setWindowTitle("ITAssetFlow")
        self.resize(
            self.DEFAULT_WIDTH,
            self.DEFAULT_HEIGHT,
        )

        # Aktiviert das native Ziehen und Andocken von DockWidgets.
        self.setDockNestingEnabled(True)
        self.setDockOptions(
            self.dockOptions()
            | QMainWindow.DockOption.AnimatedDocks
            | QMainWindow.DockOption.AllowNestedDocks
        )

        self.create_actions()
        self.create_central_area()
        self.create_left_sidebar()
        self.create_menu_bar()
        self.create_status_bar()
        self.connect_signals()
        self.apply_stylesheet()
        self.restore_window_settings()

        QTimer.singleShot(
            0,
            self.load_assets,
        )

    # ==========================================================
    # Aktionen
    # ==========================================================

    def create_actions(self) -> None:
        self.refresh_action = QAction(
            "Aktualisieren",
            self,
        )
        self.refresh_action.setShortcut("F5")
        self.refresh_action.triggered.connect(
            self.load_assets
        )

        self.sidebar_float_action = QAction(
            "Seitenleiste lösen",
            self,
        )
        self.sidebar_float_action.triggered.connect(
            self.toggle_sidebar_floating
        )

        self.exit_action = QAction(
            "Beenden",
            self,
        )
        self.exit_action.setShortcut("Ctrl+Q")
        self.exit_action.triggered.connect(
            self.close
        )

        self.about_action = QAction(
            "Über ITAssetFlow",
            self,
        )
        self.about_action.triggered.connect(
            self.show_about_dialog
        )

    # ==========================================================
    # Menüleiste
    # ==========================================================

    def create_menu_bar(self) -> None:
        menu_bar = self.menuBar()
        menu_bar.setNativeMenuBar(False)

        file_menu = menu_bar.addMenu("Datei")
        file_menu.addAction(self.refresh_action)
        file_menu.addSeparator()
        file_menu.addAction(self.exit_action)

        options_menu = menu_bar.addMenu("Optionen")
        options_menu.addAction(
            self.sidebar_float_action
        )
        options_menu.addSeparator()

        self.columns_menu = QMenu(
            "Spalten",
            self,
        )
        options_menu.addMenu(
            self.columns_menu
        )

        help_menu = menu_bar.addMenu("Hilfe")
        help_menu.addAction(self.about_action)

    # ==========================================================
    # Zentraler Tabellenbereich
    # ==========================================================

    def create_central_area(self) -> None:
        central_widget = QWidget(self)
        central_layout = QVBoxLayout(central_widget)

        central_layout.setContentsMargins(
            20,
            18,
            20,
            20,
        )
        central_layout.setSpacing(12)

        header_layout = QHBoxLayout()

        title_label = QLabel("IT-Inventar")
        title_label.setObjectName("pageTitle")

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

        header_layout.addWidget(title_label)
        header_layout.addStretch()
        header_layout.addWidget(
            self.record_count_label
        )

        self.asset_table = QTableWidget(self)

        self.asset_table.setAlternatingRowColors(True)
        self.asset_table.setSortingEnabled(True)
        self.asset_table.setShowGrid(False)
        self.asset_table.setWordWrap(False)

        self.asset_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.asset_table.setSelectionMode(
            QAbstractItemView.SelectionMode.ExtendedSelection
        )
        self.asset_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        # Die horizontale Scrollleiste bleibt sichtbar. Sobald die
        # Summe der Spaltenbreiten grösser als der Tabellenbereich ist,
        # kann damit nach rechts gescrollt werden.
        self.asset_table.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOn
        )
        self.asset_table.setVerticalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAsNeeded
        )
        self.asset_table.setHorizontalScrollMode(
            QAbstractItemView.ScrollMode.ScrollPerPixel
        )
        self.asset_table.horizontalScrollBar().setSingleStep(30)

        self.asset_table.verticalHeader().setVisible(
            False
        )

        table_header = self.asset_table.horizontalHeader()

        table_header.setObjectName("assetTableHeader")
        table_header.setHighlightSections(False)
        table_header.setStretchLastSection(False)
        table_header.setMinimumSectionSize(80)
        table_header.setSectionResizeMode(
            QHeaderView.ResizeMode.Interactive
        )

        central_layout.addLayout(header_layout)
        central_layout.addWidget(self.asset_table)

        self.setCentralWidget(central_widget)

    # ==========================================================
    # Linke Seitenleiste
    # ==========================================================

    def create_left_sidebar(self) -> None:
        self.sidebar = QDockWidget(
            "Navigation",
            self,
        )

        self.sidebar.setObjectName(
            "navigationSidebar"
        )
        self.sidebar.setAllowedAreas(
            Qt.DockWidgetArea.LeftDockWidgetArea
        )
        self.sidebar.setFeatures(
            QDockWidget.DockWidgetFeature.DockWidgetMovable
            | QDockWidget.DockWidgetFeature.DockWidgetFloatable
        )
        self.sidebar.setMinimumWidth(260)

        sidebar_widget = QWidget()
        sidebar_layout = QVBoxLayout(sidebar_widget)
        sidebar_layout.setContentsMargins(14, 14, 14, 14)
        sidebar_layout.setSpacing(10)

        search_title = QLabel("Inventar durchsuchen")
        search_title.setObjectName("sidebarTitle")

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText(
            "Alle sichtbaren Spalten durchsuchen ..."
        )
        self.search_input.setClearButtonEnabled(True)

        type_group = QGroupBox("Inventartyp")
        type_layout = QVBoxLayout(type_group)
        type_layout.setContentsMargins(10, 10, 10, 10)
        type_layout.setSpacing(5)

        self.device_checkbox = QCheckBox("Geräte")
        self.peripheral_checkbox = QCheckBox("Peripherie")
        self.component_checkbox = QCheckBox("Komponenten / Ersatzteile")
        self.other_checkbox = QCheckBox("Sonstiges")

        for checkbox in (
            self.device_checkbox,
            self.peripheral_checkbox,
            self.component_checkbox,
            self.other_checkbox,
        ):
            checkbox.setChecked(True)
            type_layout.addWidget(checkbox)

        category_group = QGroupBox("Produktkategorien")
        category_group_layout = QVBoxLayout(category_group)
        category_group_layout.setContentsMargins(8, 8, 8, 8)

        self.category_container = QWidget()
        self.category_container.setObjectName("categoryContainer")
        self.category_container.setAttribute(
            Qt.WidgetAttribute.WA_StyledBackground,
            True,
        )
        self.category_layout = QVBoxLayout(self.category_container)
        self.category_layout.setContentsMargins(2, 2, 2, 2)
        self.category_layout.setSpacing(4)

        self.category_placeholder = QLabel(
            "Kategorien werden aus Supabase geladen ..."
        )
        self.category_placeholder.setWordWrap(True)
        self.category_layout.addWidget(self.category_placeholder)
        self.category_layout.addStretch()

        self.category_scroll = QScrollArea()
        self.category_scroll.setObjectName("categoryScrollArea")
        self.category_scroll.setWidgetResizable(True)
        self.category_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.category_scroll.setMinimumHeight(120)
        self.category_scroll.setMaximumHeight(220)
        self.category_scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.category_scroll.viewport().setObjectName(
            "categoryScrollViewport"
        )
        self.category_scroll.viewport().setAttribute(
            Qt.WidgetAttribute.WA_StyledBackground,
            True,
        )
        self.category_scroll.setWidget(self.category_container)
        category_group_layout.addWidget(self.category_scroll)

        action_title = QLabel("Inventar")
        action_title.setObjectName("sidebarTitle")

        self.refresh_button = QPushButton("Daten aktualisieren")
        self.refresh_button.setObjectName("primaryButton")
        self.create_button = QPushButton("Neues Asset")
        self.edit_button = QPushButton("Asset bearbeiten")
        self.edit_button.setEnabled(False)
        self.delete_button = QPushButton("Assets löschen")
        self.delete_button.setEnabled(False)

        selection_title = QLabel("Auswahl")
        selection_title.setObjectName("sidebarTitle")

        self.selection_label = QLabel("Kein Asset ausgewählt")
        self.selection_label.setObjectName("selectionLabel")
        self.selection_label.setWordWrap(True)

        self.sidebar_count_label = QLabel("0 Datensätze")
        self.sidebar_count_label.setObjectName("sidebarCountLabel")

        sidebar_layout.addWidget(search_title)
        sidebar_layout.addWidget(self.search_input)
        sidebar_layout.addWidget(type_group)
        sidebar_layout.addWidget(category_group)
        sidebar_layout.addSpacing(6)
        sidebar_layout.addWidget(action_title)
        sidebar_layout.addWidget(self.refresh_button)
        sidebar_layout.addWidget(self.create_button)
        sidebar_layout.addWidget(self.edit_button)
        sidebar_layout.addWidget(self.delete_button)
        sidebar_layout.addStretch()
        sidebar_layout.addWidget(selection_title)
        sidebar_layout.addWidget(self.selection_label)
        sidebar_layout.addWidget(self.sidebar_count_label)

        self.sidebar.setWidget(sidebar_widget)
        self.addDockWidget(
            Qt.DockWidgetArea.LeftDockWidgetArea,
            self.sidebar,
        )

        self.sidebar.topLevelChanged.connect(
            self.handle_sidebar_floating_changed
        )

    # ==========================================================
    # Statusleiste
    # ==========================================================

    def create_status_bar(self) -> None:
        self.statusBar().showMessage("Bereit")

        self.user_label = QLabel(
            f"Angemeldet: {self.authenticated_email}"
        )
        self.user_label.setObjectName(
            "userStatusLabel"
        )

        self.statusBar().addPermanentWidget(
            self.user_label
        )

    # ==========================================================
    # Signale
    # ==========================================================

    def connect_signals(self) -> None:
        self.search_input.textChanged.connect(
            self.apply_filter
        )

        for checkbox in (
            self.device_checkbox,
            self.peripheral_checkbox,
            self.component_checkbox,
            self.other_checkbox,
        ):
            checkbox.toggled.connect(self.apply_filter)

        self.refresh_button.clicked.connect(
            self.load_assets
        )

        self.create_button.clicked.connect(
            self.show_create_asset_placeholder
        )

        self.edit_button.clicked.connect(
            self.show_edit_asset_placeholder
        )

        self.delete_button.clicked.connect(
            self.show_delete_asset_placeholder
        )

        self.asset_table.itemSelectionChanged.connect(
            self.handle_table_selection
        )

    # ==========================================================
    # Seitenleiste lösen und andocken
    # ==========================================================

    @Slot()
    def toggle_sidebar_floating(self) -> None:
        if self.sidebar.isFloating():
            self.dock_sidebar_left()
        else:
            self.sidebar.setFloating(True)
            self.sidebar.show()
            self.sidebar.raise_()

    def dock_sidebar_left(self) -> None:
        """
        Dockt die Seitenleiste explizit wieder links an.

        Zusätzlich kann die schwebende Leiste an ihrem Titel
        zum linken Fensterrand gezogen werden.
        """

        self.sidebar.setFloating(False)

        self.addDockWidget(
            Qt.DockWidgetArea.LeftDockWidgetArea,
            self.sidebar,
        )

        self.sidebar.show()
        self.sidebar.raise_()

    @Slot(bool)
    def handle_sidebar_floating_changed(
        self,
        is_floating: bool,
    ) -> None:
        if is_floating:
            self.sidebar_float_action.setText(
                "Seitenleiste links andocken"
            )
        else:
            self.sidebar_float_action.setText(
                "Seitenleiste lösen"
            )

    # ==========================================================
    # Supabase
    # ==========================================================

    @Slot()
    def load_assets(self) -> None:
        if self.is_loading:
            return

        self.set_loading_state(True)

        self.statusBar().showMessage(
            "Inventardaten werden geladen ..."
        )

        try:
            response = self.load_assets_with_product_model()

            response_data = response.data or []

            self.assets = [
                self.flatten_asset(row)
                for row in response_data
                if isinstance(row, dict)
            ]

            self.enrich_component_state(self.assets)
            category_rows = self.load_product_categories()
            self.rebuild_category_filter(
                self.assets,
                category_rows,
            )
            self.populate_table(self.assets)

            self.statusBar().showMessage(
                f"{len(self.assets)} Datensätze geladen.",
                5000,
            )

            logger.info(
                "%s assets loaded.",
                len(self.assets),
            )

        except Exception as error:
            logger.exception(
                "Could not load assets from Supabase."
            )

            self.assets = []
            self.clear_table()

            self.statusBar().showMessage(
                "Inventardaten konnten nicht geladen werden."
            )

            QMessageBox.critical(
                self,
                "Supabase-Fehler",
                (
                    "Die Inventardaten konnten nicht "
                    "geladen werden.\n\n"
                    f"Tabelle: {self.ASSET_TABLE_NAME}\n\n"
                    f"Fehler:\n{error}"
                ),
            )

        finally:
            self.set_loading_state(False)

    def load_assets_with_product_model(self) -> Any:
        """
        Lädt Assets mit Produktmodell und Produktkategorie.

        Die verschachtelte Kategorie ist für die dynamischen
        Filter in der Seitenleiste erforderlich. Falls die Relation
        noch nicht verfügbar ist, wird stufenweise zurückgefallen.
        """

        try:
            return (
                self.supabase_client
                .table(self.ASSET_TABLE_NAME)
                .select(
                    "*, "
                    "product_model:product_models("
                    "*, category:product_categories(*)"
                    ")"
                )
                .order("id")
                .execute()
            )

        except Exception:
            logger.warning(
                "Product category relation could not be loaded. "
                "Falling back to product models only.",
                exc_info=True,
            )

        try:
            return (
                self.supabase_client
                .table(self.ASSET_TABLE_NAME)
                .select("*, product_model:product_models(*)")
                .order("id")
                .execute()
            )

        except Exception:
            logger.warning(
                "Product model relation could not be loaded. "
                "Falling back to assets only.",
                exc_info=True,
            )

            return (
                self.supabase_client
                .table(self.ASSET_TABLE_NAME)
                .select("*")
                .order("id")
                .execute()
            )

    @staticmethod
    def flatten_asset(
        asset: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Wandelt verschachtelte Produktmodell-Daten in normale
        Tabellenspalten um.

        Beispiel:
            product_model.name
        wird zu:
            product_model_name
        """

        flattened: dict[str, Any] = {}

        for key, value in asset.items():
            if key == "product_model":
                continue

            flattened[key] = value

        product_model = asset.get(
            "product_model"
        )

        if isinstance(product_model, dict):
            category = product_model.get("category")

            for key, value in product_model.items():
                if key == "category":
                    continue

                flattened[f"product_model_{key}"] = value

            if isinstance(category, dict):
                for key, value in category.items():
                    flattened[f"product_category_{key}"] = value

        return flattened

    def load_product_categories(self) -> list[dict[str, Any]]:
        """Lädt alle Produktkategorien, auch solche ohne aktuelle Assets."""

        try:
            response = (
                self.supabase_client
                .table("product_categories")
                .select("*")
                .order("name")
                .execute()
            )

            return [
                row
                for row in (response.data or [])
                if isinstance(row, dict)
            ]

        except Exception:
            logger.warning(
                "Product categories could not be loaded separately.",
                exc_info=True,
            )
            return []

    def enrich_component_state(
        self,
        assets: list[dict[str, Any]],
    ) -> None:
        """
        Kennzeichnet serialisierte Komponenten als eingebaut oder frei.

        Die Abfrage ist optional. Falls die entsprechende Tabelle in
        Supabase noch nicht existiert, bleibt die Anwendung funktionsfähig.
        """

        if not assets:
            return

        try:
            response = (
                self.supabase_client
                .table("asset_component_assignments")
                .select(
                    "parent_asset_id, child_asset_id, "
                    "installed_at, removed_at"
                )
                .execute()
            )
        except Exception:
            logger.warning(
                "Component assignments could not be loaded.",
                exc_info=True,
            )
            return

        assets_by_id = {
            asset.get("id"): asset
            for asset in assets
            if asset.get("id") is not None
        }

        for asset in assets:
            if self.get_inventory_group(asset) == "component":
                asset["inventory_usage"] = "Nicht eingebaut"
                asset["installed_in"] = ""

        for assignment in response.data or []:
            if not isinstance(assignment, dict):
                continue
            if assignment.get("removed_at") is not None:
                continue

            child_asset = assets_by_id.get(
                assignment.get("child_asset_id")
            )
            parent_asset = assets_by_id.get(
                assignment.get("parent_asset_id")
            )

            if child_asset is None:
                continue

            child_asset["inventory_usage"] = "Eingebaut"
            child_asset["installed_in_asset_id"] = (
                assignment.get("parent_asset_id")
            )
            child_asset["installed_in"] = (
                self.get_asset_identifier(parent_asset)
                if parent_asset is not None
                else str(assignment.get("parent_asset_id") or "")
            )

    def rebuild_category_filter(
        self,
        assets: list[dict[str, Any]],
        category_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        """Erstellt die Kategorie-Checkboxen aus Supabase-Stammdaten."""

        previously_known = set(self.category_checkboxes)
        previously_checked = {
            key
            for key, checkbox in self.category_checkboxes.items()
            if checkbox.isChecked()
        }
        had_existing_filter = bool(self.category_checkboxes)

        while self.category_layout.count():
            item = self.category_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

        self.category_checkboxes.clear()

        categories: dict[str, str] = {}

        for category in category_rows or []:
            normalized_category = {
                f"product_category_{key}": value
                for key, value in category.items()
            }
            category_key = self.get_category_key(normalized_category)
            if category_key is None:
                continue

            categories[category_key] = self.get_category_label(
                normalized_category
            )

        # Fallback: Kategorien aus den geladenen Assets ableiten.
        if not categories:
            for asset in assets:
                category_key = self.get_category_key(asset)
                if category_key is None:
                    continue

                label = self.get_category_label(asset)
                categories[category_key] = label

        if not categories:
            placeholder = QLabel(
                "Keine Produktkategorien verfügbar. "
                "Prüfe die Relation product_models → product_categories."
            )
            placeholder.setWordWrap(True)
            self.category_layout.addWidget(placeholder)
            self.category_layout.addStretch()
            return

        for category_key, label in sorted(
            categories.items(),
            key=lambda item: item[1].casefold(),
        ):
            checkbox = QCheckBox(label)
            checkbox.setChecked(
                True
                if not had_existing_filter
                or category_key not in previously_known
                else category_key in previously_checked
            )
            checkbox.toggled.connect(self.apply_filter)
            self.category_layout.addWidget(checkbox)
            self.category_checkboxes[category_key] = checkbox

        self.category_layout.addStretch()

    @staticmethod
    def get_category_key(
        asset: dict[str, Any],
    ) -> str | None:
        for field_name in (
            "product_category_code",
            "product_category_id",
            "product_model_category_id",
            "product_category_name",
        ):
            value = asset.get(field_name)
            if value is not None and str(value).strip():
                return str(value).strip().casefold()

        return None

    @classmethod
    def get_category_label(
        cls,
        asset: dict[str, Any],
    ) -> str:
        category_code = str(
            asset.get("product_category_code") or ""
        ).strip().casefold()

        if category_code in cls.CATEGORY_LABELS:
            return cls.CATEGORY_LABELS[category_code]

        for field_name in (
            "product_category_name",
            "product_category_code",
            "product_category_id",
            "product_model_category_id",
        ):
            value = asset.get(field_name)
            if value is not None and str(value).strip():
                return str(value).strip()

        return "Unbekannte Kategorie"

    def get_inventory_group(
        self,
        asset: dict[str, Any],
    ) -> str:
        database_group = asset.get(
            "product_category_inventory_group"
        )

        if database_group is not None:
            normalized_group = str(database_group).strip().casefold()
            aliases = {
                "device": "device",
                "geraet": "device",
                "gerät": "device",
                "peripheral": "peripheral",
                "peripherie": "peripheral",
                "component": "component",
                "komponente": "component",
                "spare_part": "component",
                "ersatzteil": "component",
            }
            if normalized_group in aliases:
                return aliases[normalized_group]

        category_code = str(
            asset.get("product_category_code") or ""
        ).strip().casefold()

        if category_code in self.DEVICE_CATEGORY_CODES:
            return "device"
        if category_code in self.PERIPHERAL_CATEGORY_CODES:
            return "peripheral"
        if category_code in self.COMPONENT_CATEGORY_CODES:
            return "component"

        return "other"

    def asset_matches_category_filter(
        self,
        asset: dict[str, Any] | None,
    ) -> bool:
        if asset is None or not self.category_checkboxes:
            return True

        category_key = self.get_category_key(asset)
        if category_key is None:
            return True

        checkbox = self.category_checkboxes.get(category_key)
        return checkbox is None or checkbox.isChecked()

    def asset_matches_group_filter(
        self,
        asset: dict[str, Any] | None,
    ) -> bool:
        if asset is None:
            return True

        group = self.get_inventory_group(asset)
        group_checkboxes = {
            "device": self.device_checkbox,
            "peripheral": self.peripheral_checkbox,
            "component": self.component_checkbox,
            "other": self.other_checkbox,
        }

        return group_checkboxes[group].isChecked()

    # ==========================================================
    # Tabelle
    # ==========================================================

    def populate_table(
        self,
        assets: list[dict[str, Any]],
    ) -> None:
        self.asset_table.setSortingEnabled(False)
        self.asset_table.clearContents()
        self.asset_table.clearSelection()

        if not assets:
            self.clear_table()
            return

        self.current_columns = self.determine_columns(
            assets
        )

        self.initialize_visible_columns()

        self.asset_table.setColumnCount(
            len(self.current_columns)
        )
        self.asset_table.setRowCount(
            len(assets)
        )

        self.asset_table.setHorizontalHeaderLabels(
            [
                self.get_header_label(column)
                for column in self.current_columns
            ]
        )

        for row_index, asset in enumerate(assets):
            for column_index, column_name in enumerate(
                self.current_columns
            ):
                display_value = self.format_value(
                    asset.get(column_name)
                )

                item = QTableWidgetItem(
                    display_value
                )
                item.setToolTip(display_value)

                # Der vollständige Datensatz bleibt mit der
                # Tabellenzeile verbunden.
                if column_index == 0:
                    item.setData(
                        Qt.ItemDataRole.UserRole,
                        asset,
                    )

                self.asset_table.setItem(
                    row_index,
                    column_index,
                    item,
                )

        self.rebuild_columns_menu()
        self.apply_column_visibility()

        self.asset_table.setSortingEnabled(True)
        self.resize_visible_columns()
        self.apply_filter()

    def determine_columns(
        self,
        assets: list[dict[str, Any]],
    ) -> list[str]:
        discovered_columns: list[str] = []

        for asset in assets:
            for column_name in asset:
                if (
                    column_name
                    not in discovered_columns
                ):
                    discovered_columns.append(
                        column_name
                    )

        preferred = [
            column
            for column in self.PREFERRED_COLUMN_ORDER
            if column in discovered_columns
        ]

        additional = [
            column
            for column in discovered_columns
            if column not in preferred
        ]

        return preferred + additional

    def initialize_visible_columns(self) -> None:
        available_columns = set(
            self.current_columns
        )

        if not self.column_visibility_initialized:
            default_columns = (
                self.DEFAULT_VISIBLE_COLUMNS
                & available_columns
            )

            # Falls keine der erwarteten Spalten existiert,
            # werden die ersten fünf Spalten verwendet.
            if not default_columns:
                default_columns = set(
                    self.current_columns[:5]
                )

            self.visible_columns = default_columns
            self.column_visibility_initialized = True

        else:
            self.visible_columns &= available_columns

            if not self.visible_columns:
                self.visible_columns = set(
                    self.current_columns[:5]
                )

    def rebuild_columns_menu(self) -> None:
        self.columns_menu.clear()
        self.column_actions.clear()

        show_all_action = QAction(
            "Alle einblenden",
            self,
        )
        show_all_action.triggered.connect(
            self.show_all_columns
        )
        self.columns_menu.addAction(
            show_all_action
        )

        reset_action = QAction(
            "Standardansicht",
            self,
        )
        reset_action.triggered.connect(
            self.reset_visible_columns
        )
        self.columns_menu.addAction(
            reset_action
        )

        self.columns_menu.addSeparator()

        for column_name in self.current_columns:
            action = QAction(
                self.get_header_label(column_name),
                self,
            )
            action.setCheckable(True)
            action.setChecked(
                column_name in self.visible_columns
            )

            action.toggled.connect(
                lambda checked, name=column_name:
                self.set_column_visible(
                    name,
                    checked,
                )
            )

            self.columns_menu.addAction(action)
            self.column_actions[column_name] = action

    def set_column_visible(
        self,
        column_name: str,
        visible: bool,
    ) -> None:
        if visible:
            self.visible_columns.add(
                column_name
            )
        else:
            if len(self.visible_columns) <= 1:
                action = self.column_actions.get(
                    column_name
                )

                if action is not None:
                    action.blockSignals(True)
                    action.setChecked(True)
                    action.blockSignals(False)

                self.statusBar().showMessage(
                    "Mindestens eine Spalte muss sichtbar bleiben.",
                    3000,
                )
                return

            self.visible_columns.discard(
                column_name
            )

        self.apply_column_visibility()
        self.resize_visible_columns()
        self.apply_filter()

    @Slot()
    def show_all_columns(self) -> None:
        self.visible_columns = set(
            self.current_columns
        )

        self.sync_column_actions()
        self.apply_column_visibility()
        self.resize_visible_columns()
        self.apply_filter()

    @Slot()
    def reset_visible_columns(self) -> None:
        available_columns = set(
            self.current_columns
        )

        self.visible_columns = (
            self.DEFAULT_VISIBLE_COLUMNS
            & available_columns
        )

        if not self.visible_columns:
            self.visible_columns = set(
                self.current_columns[:5]
            )

        self.sync_column_actions()
        self.apply_column_visibility()
        self.resize_visible_columns()
        self.apply_filter()

    def sync_column_actions(self) -> None:
        for column_name, action in (
            self.column_actions.items()
        ):
            action.blockSignals(True)
            action.setChecked(
                column_name
                in self.visible_columns
            )
            action.blockSignals(False)

    def apply_column_visibility(self) -> None:
        for column_index, column_name in enumerate(
            self.current_columns
        ):
            self.asset_table.setColumnHidden(
                column_index,
                column_name
                not in self.visible_columns,
            )

    def resize_visible_columns(self) -> None:
        self.asset_table.resizeColumnsToContents()

        # Die Spalten werden nicht auf die Fensterbreite gestreckt.
        # Dadurch bleibt ihre Gesamtbreite erhalten und Qt kann bei
        # vielen sichtbaren Spalten horizontal scrollen.
        minimum_width = 115
        maximum_width = 320

        for column_index, column_name in enumerate(
            self.current_columns
        ):
            if (
                column_name
                not in self.visible_columns
            ):
                continue

            current_width = self.asset_table.columnWidth(
                column_index
            )
            target_width = max(
                minimum_width,
                min(current_width, maximum_width),
            )

            self.asset_table.setColumnWidth(
                column_index,
                target_width,
            )

        self.asset_table.updateGeometry()
        self.asset_table.viewport().update()

    def clear_table(self) -> None:
        self.asset_table.setSortingEnabled(False)
        self.asset_table.clearContents()
        self.asset_table.setRowCount(0)
        self.asset_table.setColumnCount(0)
        self.asset_table.setSortingEnabled(True)

        self.current_columns = []
        self.rebuild_category_filter([], [])
        self.columns_menu.clear()
        self.column_actions.clear()

        self.update_count_labels(0, 0)
        self.clear_selected_asset()

    @classmethod
    def get_header_label(
        cls,
        column_name: str,
    ) -> str:
        return cls.HEADER_LABELS.get(
            column_name,
            column_name
            .replace("_", " ")
            .strip()
            .title(),
        )

    @staticmethod
    def format_value(value: Any) -> str:
        if value is None:
            return ""

        if isinstance(value, bool):
            return "Ja" if value else "Nein"

        if isinstance(value, (dict, list)):
            return json.dumps(
                value,
                ensure_ascii=False,
            )

        return str(value)

    def set_loading_state(
        self,
        is_loading: bool,
    ) -> None:
        self.is_loading = is_loading

        self.refresh_action.setEnabled(
            not is_loading
        )
        self.refresh_button.setEnabled(
            not is_loading
        )

        self.refresh_button.setText(
            "Daten werden geladen ..."
            if is_loading
            else "Daten aktualisieren"
        )

    # ==========================================================
    # Filter
    # ==========================================================

    @Slot()
    def apply_filter(self) -> None:
        search_text = (
            self.search_input
            .text()
            .strip()
            .casefold()
        )

        total_count = self.asset_table.rowCount()
        visible_count = 0

        for row_index in range(total_count):
            asset = self.get_asset_from_row(row_index)

            search_matches = (
                not search_text
                or self.row_matches_visible_columns(
                    row_index,
                    search_text,
                )
            )
            category_matches = (
                self.asset_matches_category_filter(asset)
            )
            group_matches = (
                self.asset_matches_group_filter(asset)
            )

            row_matches = (
                search_matches
                and category_matches
                and group_matches
            )

            self.asset_table.setRowHidden(
                row_index,
                not row_matches,
            )

            if row_matches:
                visible_count += 1

        self.update_count_labels(
            visible_count,
            total_count,
        )

    def row_matches_visible_columns(
        self,
        row_index: int,
        search_text: str,
    ) -> bool:
        for column_index, column_name in enumerate(
            self.current_columns
        ):
            if (
                column_name
                not in self.visible_columns
            ):
                continue

            item = self.asset_table.item(
                row_index,
                column_index,
            )

            if (
                item is not None
                and search_text
                in item.text().casefold()
            ):
                return True

        return False

    def asset_matches_name(
        self,
        asset: dict[str, Any] | None,
        search_text: str,
    ) -> bool:
        if asset is None:
            return False

        name_values: list[str] = []

        for field_name in self.NAME_FIELDS:
            value = asset.get(field_name)

            if value is not None:
                name_values.append(
                    str(value).strip().casefold()
                )

        # Zusätzliche dynamische Namensfelder berücksichtigen.
        if not name_values:
            for field_name, value in asset.items():
                if not field_name.casefold().endswith(
                    "name"
                ):
                    continue

                if value is not None:
                    name_values.append(
                        str(value).strip().casefold()
                    )

        return search_text in name_values

    # ==========================================================
    # Auswahl
    # ==========================================================

    @Slot()
    def handle_table_selection(self) -> None:
        assets = self.get_selected_assets()

        if not assets:
            self.clear_selected_asset()
            return

        if len(assets) == 1:
            identifier = self.get_asset_identifier(assets[0])
            self.selection_label.setText(
                f"Ausgewähltes Asset:\n{identifier}"
            )
            self.edit_button.setEnabled(True)
        else:
            self.selection_label.setText(
                f"{len(assets)} Assets ausgewählt"
            )
            # Mehrfachbearbeitung ist noch nicht implementiert.
            self.edit_button.setEnabled(False)

        self.delete_button.setEnabled(True)

    def get_asset_from_row(
        self,
        row_index: int,
    ) -> dict[str, Any] | None:
        if self.asset_table.columnCount() == 0:
            return None

        first_item = self.asset_table.item(row_index, 0)
        if first_item is None:
            return None

        asset = first_item.data(Qt.ItemDataRole.UserRole)
        return asset if isinstance(asset, dict) else None

    def get_selected_assets(self) -> list[dict[str, Any]]:
        selection_model = self.asset_table.selectionModel()
        if selection_model is None:
            return []

        assets: list[dict[str, Any]] = []

        for index in sorted(
            selection_model.selectedRows(),
            key=lambda selected_index: selected_index.row(),
        ):
            asset = self.get_asset_from_row(index.row())
            if asset is not None:
                assets.append(asset)

        return assets

    def get_selected_asset(
        self,
    ) -> dict[str, Any] | None:
        assets = self.get_selected_assets()
        return assets[0] if len(assets) == 1 else None

    def clear_selected_asset(self) -> None:
        self.selection_label.setText(
            "Kein Asset ausgewählt"
        )
        self.edit_button.setEnabled(False)
        self.delete_button.setEnabled(False)

    @staticmethod
    def get_asset_identifier(
        asset: dict[str, Any],
    ) -> str:
        for field_name in (
            "asset_tag",
            "name",
            "product_model_name",
            "product_model_model_name",
            "inventory_number",
            "serial_number",
            "hostname",
            "id",
        ):
            value = asset.get(field_name)

            if (
                value is not None
                and str(value).strip()
            ):
                return str(value).strip()

        return "Unbekanntes Asset"

    # ==========================================================
    # Zähler
    # ==========================================================

    def update_count_labels(
        self,
        visible_count: int,
        total_count: int,
    ) -> None:
        if visible_count == total_count:
            text = f"{total_count} Datensätze"
        else:
            text = (
                f"{visible_count} von "
                f"{total_count} Datensätzen"
            )

        self.record_count_label.setText(text)
        self.sidebar_count_label.setText(text)

    # ==========================================================
    # Platzhalter
    # ==========================================================

    @Slot()
    def show_create_asset_placeholder(self) -> None:
        QMessageBox.information(
            self,
            "Neues Asset",
            "Diese Funktion wird im nächsten Schritt ergänzt.",
        )

    @Slot()
    def show_edit_asset_placeholder(self) -> None:
        asset = self.get_selected_asset()

        if asset is None:
            QMessageBox.information(
                self,
                "Asset bearbeiten",
                "Bitte zuerst ein Asset auswählen.",
            )
            return

        QMessageBox.information(
            self,
            "Asset bearbeiten",
            (
                "Diese Funktion wird im nächsten Schritt ergänzt.\n\n"
                f"Ausgewählt: "
                f"{self.get_asset_identifier(asset)}"
            ),
        )

    @Slot()
    def show_delete_asset_placeholder(self) -> None:
        assets = self.get_selected_assets()

        if not assets:
            QMessageBox.information(
                self,
                "Assets löschen",
                "Bitte zuerst mindestens ein Asset auswählen.",
            )
            return

        identifiers = [
            self.get_asset_identifier(asset)
            for asset in assets[:5]
        ]
        selection_text = "\n".join(
            f"• {identifier}"
            for identifier in identifiers
        )

        if len(assets) > 5:
            selection_text += (
                f"\n• … und {len(assets) - 5} weitere"
            )

        QMessageBox.information(
            self,
            "Assets löschen",
            (
                "Diese Funktion wird im nächsten Schritt ergänzt.\n\n"
                f"{len(assets)} Assets ausgewählt:\n"
                f"{selection_text}"
            ),
        )

    @Slot()
    def show_about_dialog(self) -> None:
        QMessageBox.about(
            self,
            "Über ITAssetFlow",
            (
                "<h2>ITAssetFlow</h2>"
                "<p>Inventarverwaltung für IT-Materialien.</p>"
                "<p>Datenbank und Authentifizierung über Supabase.</p>"
                "<p>DLC-Informatik GmbH</p>"
            ),
        )

    # ==========================================================
    # Design
    # ==========================================================

    def apply_stylesheet(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow {
                background-color: #f4f6f8;
            }

            QMenuBar {
                background-color: #ffffff;
                color: #111827;
                border-bottom: 1px solid #d8dde3;
                padding: 3px;
            }

            QMenuBar::item {
                background: transparent;
                color: #111827;
                padding: 7px 11px;
            }

            QMenuBar::item:selected,
            QMenuBar::item:pressed {
                background-color: #e9eef4;
                color: #111827;
                border-radius: 4px;
            }

            QMenu {
                background-color: #ffffff;
                color: #111827;
                border: 1px solid #d8dde3;
                padding: 4px;
            }

            QMenu::item {
                color: #111827;
                padding: 7px 30px 7px 12px;
            }

            QMenu::item:selected {
                background-color: #e9eef4;
                color: #111827;
            }

            QDockWidget {
                color: #111827;
                font-weight: 600;
            }

            QDockWidget::title {
                background-color: #f3f4f6;
                color: #111827;
                padding: 7px;
                border-bottom: 1px solid #d8dde3;
            }

            QDockWidget > QWidget {
                background-color: #ffffff;
                color: #111827;
            }

            QLabel {
                color: #111827;
            }

            QLabel#pageTitle {
                font-size: 23px;
                font-weight: 600;
            }

            QLabel#recordCountLabel,
            QLabel#sidebarCountLabel {
                color: #66717c;
            }

            QLabel#sidebarTitle {
                font-size: 14px;
                font-weight: 600;
                margin-top: 3px;
            }

            QLabel#selectionLabel {
                background-color: #f5f7f9;
                border: 1px solid #d8dde3;
                border-radius: 6px;
                padding: 10px;
            }

            QGroupBox {
                background-color: #ffffff;
                color: #111827;
                font-weight: 600;
                border: 1px solid #d8dde3;
                border-radius: 6px;
                margin-top: 8px;
                padding-top: 8px;
            }

            QGroupBox::title {
                subcontrol-origin: margin;
                left: 8px;
                padding: 0 4px;
            }

            QCheckBox {
                background-color: transparent;
                color: #111827;
                spacing: 7px;
                font-weight: 400;
            }

            /* Unter Windows-Dark-Mode übernimmt der Viewport eines
               QScrollArea sonst teilweise die dunkle Systempalette. */
            QScrollArea#categoryScrollArea,
            QWidget#categoryScrollViewport,
            QWidget#categoryContainer {
                background-color: #ffffff;
                color: #111827;
                border: none;
            }

            QLineEdit {
                min-height: 34px;
                padding-left: 9px;
                padding-right: 9px;
                background-color: #ffffff;
                color: #111827;
                border: 1px solid #c9d1d9;
                border-radius: 5px;
            }

            QLineEdit:focus {
                border: 1px solid #2f6fb7;
            }


            QPushButton {
                min-height: 35px;
                padding: 0 11px;
                text-align: left;
                background-color: #ffffff;
                color: #111827;
                border: 1px solid #c9d1d9;
                border-radius: 5px;
            }

            QPushButton:hover {
                background-color: #edf2f6;
            }

            QPushButton:disabled {
                color: #9ba4ad;
                background-color: #f4f6f8;
            }

            QPushButton#primaryButton {
                background-color: #2868ad;
                border-color: #2868ad;
                color: #ffffff;
                font-weight: 600;
            }

            QPushButton#primaryButton:hover {
                background-color: #215b98;
            }

            QTableWidget {
                background-color: #ffffff;
                alternate-background-color: #f8fafb;
                color: #111827;
                border: 1px solid #d8dde3;
                border-radius: 6px;
                outline: 0;
                selection-background-color: #cfe4ff;
                selection-color: #111827;
            }

            QTableWidget::item {
                padding: 7px;
                border: none;
                border-bottom: 1px solid #edf0f2;
            }

            QTableWidget::item:selected {
                background-color: #cfe4ff;
                color: #111827;
                border: none;
                outline: none;
            }

            QTableWidget::item:focus {
                border: none;
                outline: none;
            }

            /* Auch der leere Bereich rechts neben der letzten
               Tabellenüberschrift erhält eine helle Farbe. */
            QHeaderView {
                background-color: #edf1f5;
                color: #111827;
            }

            QHeaderView::section {
                background-color: #edf1f5;
                color: #111827;
                border: none;
                border-right: 1px solid #d8dde3;
                border-bottom: 1px solid #d8dde3;
                padding: 8px;
                font-weight: 600;
            }

            QTableCornerButton::section {
                background-color: #edf1f5;
                border: none;
                border-right: 1px solid #d8dde3;
                border-bottom: 1px solid #d8dde3;
            }

            /* Explizite Scrollbar-Farben verhindern unleserliche
               Steuerelemente bei aktivem Windows-Dark-Mode. */
            QScrollBar:horizontal {
                background-color: #e5e7eb;
                height: 16px;
                margin: 0;
                border: 1px solid #cbd5e1;
            }

            QScrollBar::handle:horizontal {
                background-color: #8b96a3;
                min-width: 36px;
                margin: 2px;
                border-radius: 5px;
            }

            QScrollBar::handle:horizontal:hover {
                background-color: #647181;
            }

            QScrollBar:vertical {
                background-color: #e5e7eb;
                width: 16px;
                margin: 0;
                border: 1px solid #cbd5e1;
            }

            QScrollBar::handle:vertical {
                background-color: #8b96a3;
                min-height: 36px;
                margin: 2px;
                border-radius: 5px;
            }

            QScrollBar::handle:vertical:hover {
                background-color: #647181;
            }

            QScrollBar::add-line,
            QScrollBar::sub-line {
                width: 0;
                height: 0;
                background: none;
                border: none;
            }

            QScrollBar::add-page,
            QScrollBar::sub-page {
                background: transparent;
            }

            QToolTip {
                background-color: #ffffff;
                color: #111827;
                border: 1px solid #9ca3af;
                padding: 4px;
            }

            QStatusBar {
                background-color: #ffffff;
                color: #5c6670;
                border-top: 1px solid #d8dde3;
            }

            QLabel#userStatusLabel {
                padding-left: 12px;
                padding-right: 8px;
                color: #5c6670;
            }
            """
        )

    # ==========================================================
    # Fenstereinstellungen
    # ==========================================================

    def restore_window_settings(self) -> None:
        geometry = (
            self.settings_manager
            .load_window_geometry()
        )

        if geometry:
            self.restoreGeometry(geometry)

        if not self.is_on_available_screen():
            self.move_to_primary_screen()

        if (
            self.settings_manager
            .load_window_maximized()
        ):
            self.showMaximized()

    def is_on_available_screen(self) -> bool:
        window_geometry = self.frameGeometry()

        return any(
            screen.availableGeometry().intersects(
                window_geometry
            )
            for screen in QGuiApplication.screens()
        )

    def move_to_primary_screen(self) -> None:
        screen = QGuiApplication.primaryScreen()

        if screen is None:
            return

        self.resize(
            self.DEFAULT_WIDTH,
            self.DEFAULT_HEIGHT,
        )

        screen_geometry = screen.availableGeometry()

        x_position = (
            screen_geometry.x()
            + (
                screen_geometry.width()
                - self.width()
            )
            // 2
        )

        y_position = (
            screen_geometry.y()
            + (
                screen_geometry.height()
                - self.height()
            )
            // 2
        )

        self.move(
            x_position,
            y_position,
        )

    def closeEvent(
        self,
        event: QCloseEvent,
    ) -> None:
        self.settings_manager.save_window_geometry(
            self.saveGeometry()
        )

        self.settings_manager.save_window_maximized(
            self.isMaximized()
        )

        event.accept()