from __future__ import annotations

import json
import logging
from typing import Any

from PySide6.QtCore import Qt, QTimer, Slot
from PySide6.QtGui import QAction, QCloseEvent, QGuiApplication
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QDockWidget,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMenu,
    QMessageBox,
    QPushButton,
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

    PREFERRED_COLUMN_ORDER = [
        "id",
        "asset_tag",
        "name",
        "inventory_number",
        "hostname",
        "serial_number",
        "product_model_name",
        "product_model_model_name",
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
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.asset_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )

        self.asset_table.verticalHeader().setVisible(
            False
        )

        table_header = self.asset_table.horizontalHeader()

        table_header.setHighlightSections(False)
        table_header.setStretchLastSection(True)
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

        # Die Leiste darf nur links angedockt werden.
        self.sidebar.setAllowedAreas(
            Qt.DockWidgetArea.LeftDockWidgetArea
        )

        # Kein DockWidgetClosable: kein Schließen-Kreuz.
        self.sidebar.setFeatures(
            QDockWidget.DockWidgetFeature.DockWidgetMovable
            | QDockWidget.DockWidgetFeature.DockWidgetFloatable
        )

        self.sidebar.setMinimumWidth(240)

        sidebar_widget = QWidget()
        sidebar_layout = QVBoxLayout(
            sidebar_widget
        )

        sidebar_layout.setContentsMargins(
            14,
            14,
            14,
            14,
        )
        sidebar_layout.setSpacing(10)

        search_title = QLabel(
            "Inventar filtern"
        )
        search_title.setObjectName(
            "sidebarTitle"
        )

        self.filter_field_combo = QComboBox()
        self.filter_field_combo.addItem(
            "Alle sichtbaren Spalten",
            "all",
        )
        self.filter_field_combo.addItem(
            "Name exakt",
            "name",
        )

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText(
            "Suchbegriff eingeben ..."
        )
        self.search_input.setClearButtonEnabled(True)

        action_title = QLabel("Inventar")
        action_title.setObjectName(
            "sidebarTitle"
        )

        self.refresh_button = QPushButton(
            "Daten aktualisieren"
        )
        self.refresh_button.setObjectName(
            "primaryButton"
        )

        self.create_button = QPushButton(
            "Neues Asset"
        )

        self.edit_button = QPushButton(
            "Asset bearbeiten"
        )
        self.edit_button.setEnabled(False)

        self.delete_button = QPushButton(
            "Asset löschen"
        )
        self.delete_button.setEnabled(False)

        selection_title = QLabel("Auswahl")
        selection_title.setObjectName(
            "sidebarTitle"
        )

        self.selection_label = QLabel(
            "Kein Asset ausgewählt"
        )
        self.selection_label.setObjectName(
            "selectionLabel"
        )
        self.selection_label.setWordWrap(True)

        self.sidebar_count_label = QLabel(
            "0 Datensätze"
        )
        self.sidebar_count_label.setObjectName(
            "sidebarCountLabel"
        )

        sidebar_layout.addWidget(search_title)
        sidebar_layout.addWidget(
            self.filter_field_combo
        )
        sidebar_layout.addWidget(
            self.search_input
        )

        sidebar_layout.addSpacing(10)
        sidebar_layout.addWidget(action_title)
        sidebar_layout.addWidget(
            self.refresh_button
        )
        sidebar_layout.addWidget(
            self.create_button
        )
        sidebar_layout.addWidget(
            self.edit_button
        )
        sidebar_layout.addWidget(
            self.delete_button
        )

        sidebar_layout.addStretch()

        sidebar_layout.addWidget(
            selection_title
        )
        sidebar_layout.addWidget(
            self.selection_label
        )
        sidebar_layout.addWidget(
            self.sidebar_count_label
        )

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

        self.filter_field_combo.currentIndexChanged.connect(
            self.handle_filter_type_changed
        )

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
        Versucht zuerst, das zugehörige Produktmodell mitzuladen.

        Falls die eingebettete Relation nicht verfügbar ist,
        werden nur die Assets geladen.
        """

        try:
            return (
                self.supabase_client
                .table(self.ASSET_TABLE_NAME)
                .select(
                    "*, product_model:product_models(*)"
                )
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
            for key, value in product_model.items():
                flattened[
                    f"product_model_{key}"
                ] = value

        return flattened

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

        maximum_width = 320

        for column_index, column_name in enumerate(
            self.current_columns
        ):
            if (
                column_name
                not in self.visible_columns
            ):
                continue

            width = self.asset_table.columnWidth(
                column_index
            )

            if width > maximum_width:
                self.asset_table.setColumnWidth(
                    column_index,
                    maximum_width,
                )

    def clear_table(self) -> None:
        self.asset_table.setSortingEnabled(False)
        self.asset_table.clearContents()
        self.asset_table.setRowCount(0)
        self.asset_table.setColumnCount(0)
        self.asset_table.setSortingEnabled(True)

        self.current_columns = []
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
    def handle_filter_type_changed(self) -> None:
        filter_type = (
            self.filter_field_combo.currentData()
        )

        if filter_type == "name":
            self.search_input.setPlaceholderText(
                "Exakten Namen eingeben ..."
            )
        else:
            self.search_input.setPlaceholderText(
                "Suchbegriff eingeben ..."
            )

        self.apply_filter()

    @Slot()
    def apply_filter(self) -> None:
        search_text = (
            self.search_input
            .text()
            .strip()
            .casefold()
        )

        filter_type = (
            self.filter_field_combo.currentData()
        )

        total_count = self.asset_table.rowCount()
        visible_count = 0

        for row_index in range(total_count):
            if not search_text:
                row_matches = True

            elif filter_type == "name":
                asset = self.get_asset_from_row(
                    row_index
                )

                row_matches = self.asset_matches_name(
                    asset,
                    search_text,
                )

            else:
                row_matches = (
                    self.row_matches_visible_columns(
                        row_index,
                        search_text,
                    )
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
        asset = self.get_selected_asset()

        if asset is None:
            self.clear_selected_asset()
            return

        identifier = self.get_asset_identifier(
            asset
        )

        self.selection_label.setText(
            f"Ausgewähltes Asset:\n{identifier}"
        )

        self.edit_button.setEnabled(True)
        self.delete_button.setEnabled(True)

    def get_asset_from_row(
        self,
        row_index: int,
    ) -> dict[str, Any] | None:
        if self.asset_table.columnCount() == 0:
            return None

        first_item = self.asset_table.item(
            row_index,
            0,
        )

        if first_item is None:
            return None

        asset = first_item.data(
            Qt.ItemDataRole.UserRole
        )

        return asset if isinstance(asset, dict) else None

    def get_selected_asset(
        self,
    ) -> dict[str, Any] | None:
        selection_model = (
            self.asset_table.selectionModel()
        )

        if selection_model is None:
            return None

        selected_rows = (
            selection_model.selectedRows()
        )

        if not selected_rows:
            return None

        return self.get_asset_from_row(
            selected_rows[0].row()
        )

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
        asset = self.get_selected_asset()

        if asset is None:
            QMessageBox.information(
                self,
                "Asset löschen",
                "Bitte zuerst ein Asset auswählen.",
            )
            return

        QMessageBox.information(
            self,
            "Asset löschen",
            (
                "Diese Funktion wird im nächsten Schritt ergänzt.\n\n"
                f"Ausgewählt: "
                f"{self.get_asset_identifier(asset)}"
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

            QLineEdit,
            QComboBox {
                min-height: 34px;
                padding-left: 9px;
                padding-right: 9px;
                background-color: #ffffff;
                color: #111827;
                border: 1px solid #c9d1d9;
                border-radius: 5px;
            }

            QLineEdit:focus,
            QComboBox:focus {
                border: 1px solid #2f6fb7;
            }

            QComboBox QAbstractItemView {
                background-color: #ffffff;
                color: #111827;
                selection-background-color: #dbeafe;
                selection-color: #111827;
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

            QHeaderView::section {
                background-color: #edf1f5;
                color: #111827;
                border: none;
                border-right: 1px solid #d8dde3;
                border-bottom: 1px solid #d8dde3;
                padding: 8px;
                font-weight: 600;
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