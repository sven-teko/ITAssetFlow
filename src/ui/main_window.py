from __future__ import annotations

from typing import Any

from PySide6.QtCore import Qt, QTimer, Slot
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

from .asset_detail_sidebar import AssetDetailSidebar
from .asset_table_widget import AssetTableWidget
from .dock_manager import DockManager
from .inventory_sidebar import InventorySidebar
from .inventory_view_controller import InventoryViewController
from .main_window_menu import MainWindowMenu

from inventory import get_asset_identifier


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
            self.show_create_asset_placeholder
        )
        self.sidebar.edit_requested.connect(
            self.show_edit_asset_placeholder
        )
        self.sidebar.delete_requested.connect(
            self.show_delete_asset_placeholder
        )

    def _connect_menu_signals(self) -> None:
        menu = self.menu_controller

        menu.refresh_requested.connect(
            self.inventory_controller.load_inventory
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
        loading: bool,
    ) -> None:
        self.menu_controller.set_loading_state(
            loading
        )
        self.sidebar.set_loading_state(
            loading
        )

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
    # Schreibaktionen – derzeit noch Platzhalter
    # ------------------------------------------------------------------

    @Slot()
    def show_create_asset_placeholder(self) -> None:
        QMessageBox.information(
            self,
            "Neuer Eintrag",
            "Diese Funktion wird im nächsten Schritt ergänzt.",
        )

    @Slot()
    def show_edit_asset_placeholder(self) -> None:
        asset = (
            self.asset_table.get_selected_asset()
        )

        if asset is None:
            QMessageBox.information(
                self,
                "Eintrag bearbeiten",
                "Bitte genau einen Eintrag auswählen.",
            )
            return

        QMessageBox.information(
            self,
            "Eintrag bearbeiten",
            (
                "Diese Funktion wird im nächsten Schritt ergänzt.\n\n"
                f"Ausgewählt: {get_asset_identifier(asset)}"
            ),
        )

    @Slot()
    def show_delete_asset_placeholder(self) -> None:
        assets = (
            self.asset_table.get_selected_assets()
        )

        if not assets:
            QMessageBox.information(
                self,
                "Einträge löschen",
                "Bitte zuerst mindestens einen Eintrag auswählen.",
            )
            return

        identifiers = [
            get_asset_identifier(asset)
            for asset in assets[:5]
        ]

        text = "\n".join(
            f"• {identifier}"
            for identifier in identifiers
        )

        if len(assets) > 5:
            text += (
                f"\n• … und {len(assets) - 5} weitere"
            )

        QMessageBox.information(
            self,
            "Einträge löschen",
            (
                "Diese Funktion wird im nächsten Schritt ergänzt.\n\n"
                f"{len(assets)} Einträge ausgewählt:\n{text}"
            ),
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