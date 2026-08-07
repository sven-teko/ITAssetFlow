from __future__ import annotations

import json
import logging
from typing import Any, Callable

from PySide6.QtCore import Qt, QTimer, Signal, Slot
from PySide6.QtGui import QAction, QCloseEvent, QGuiApplication
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMainWindow,
    QMenu,
    QMessageBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)
from supabase import Client

logger = logging.getLogger(__name__)

try:
    from settings_manager import SettingsManager
except Exception:
    SettingsManager = None  # type: ignore[assignment]
    logger.warning("SettingsManager ist nicht verfügbar.", exc_info=True)

try:
    from infrastructure.asset_repository import AssetRepository
except Exception:
    AssetRepository = None  # type: ignore[assignment]
    logger.warning("AssetRepository ist nicht verfügbar.", exc_info=True)

try:
    from infrastructure.inventory_change_monitor import InventoryChangeMonitor
except Exception:
    InventoryChangeMonitor = None  # type: ignore[assignment]
    logger.warning(
        "InventoryChangeMonitor ist nicht verfügbar; Cloud-Auto-Refresh deaktiviert.",
        exc_info=True,
    )

try:
    from .asset_table_widget import AssetTableWidget
except ImportError:
    AssetTableWidget = None  # type: ignore[assignment]
    logger.warning("AssetTableWidget ist nicht verfügbar.", exc_info=True)

try:
    from .inventory_sidebar import InventorySidebar
except ImportError:
    InventorySidebar = None  # type: ignore[assignment]
    logger.warning("InventorySidebar ist nicht verfügbar.", exc_info=True)

try:
    from .theme import apply_light_theme
except ImportError:
    apply_light_theme = None  # type: ignore[assignment]
    logger.warning("Theme ist nicht verfügbar.", exc_info=True)

try:
    from inventory import get_asset_identifier
except Exception:
    def get_asset_identifier(asset: dict[str, Any] | None) -> str:
        if not asset:
            return "Unbekanntes Asset"
        for field in ("asset_tag", "name", "serial_number", "id"):
            value = asset.get(field)
            if value is not None and str(value).strip():
                return str(value).strip()
        return "Unbekanntes Asset"


class BasicAssetTable(QTableWidget):
    """Minimale Ersatztabelle, falls das Tabellenmodul fehlt."""

    counts_changed = Signal(int, int)

    def __init__(self, _columns_menu: QMenu | None = None, parent=None) -> None:
        super().__init__(parent)
        self.current_columns: list[str] = []
        self.setAlternatingRowColors(True)
        self.setSortingEnabled(True)
        self.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOn)
        self.setHorizontalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self.verticalHeader().setVisible(False)
        header = self.horizontalHeader()
        header.setStretchLastSection(False)
        header.setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        header.setSectionsMovable(True)

    def populate_assets(self, assets: list[dict[str, Any]]) -> None:
        self.setSortingEnabled(False)
        self.clearContents()
        self.clearSelection()
        self.current_columns = list(
            dict.fromkeys(column for asset in assets for column in asset)
        )
        self.setColumnCount(len(self.current_columns))
        self.setRowCount(len(assets))
        self.setHorizontalHeaderLabels(
            [column.replace("_", " ").title() for column in self.current_columns]
        )
        for row, asset in enumerate(assets):
            for column, name in enumerate(self.current_columns):
                value = asset.get(name)
                text = (
                    json.dumps(value, ensure_ascii=False)
                    if isinstance(value, (dict, list))
                    else "" if value is None else str(value)
                )
                item = QTableWidgetItem(text)
                if column == 0:
                    item.setData(Qt.ItemDataRole.UserRole, asset)
                self.setItem(row, column, item)
        self.resizeColumnsToContents()
        self.setSortingEnabled(True)
        self.counts_changed.emit(len(assets), len(assets))

    def clear_assets(self) -> None:
        self.clearContents()
        self.setRowCount(0)
        self.setColumnCount(0)
        self.current_columns = []
        self.counts_changed.emit(0, 0)

    def get_asset_from_row(self, row: int) -> dict[str, Any] | None:
        item = self.item(row, 0) if self.columnCount() else None
        value = item.data(Qt.ItemDataRole.UserRole) if item else None
        return value if isinstance(value, dict) else None

    def get_selected_assets(self) -> list[dict[str, Any]]:
        selection = self.selectionModel()
        if selection is None:
            return []
        assets: list[dict[str, Any]] = []
        for index in selection.selectedRows():
            asset = self.get_asset_from_row(index.row())
            if asset is not None:
                assets.append(asset)
        return assets

    def get_selected_asset(self) -> dict[str, Any] | None:
        assets = self.get_selected_assets()
        return assets[0] if len(assets) == 1 else None

    def filter_rows(
        self,
        search_text: str,
        predicate: Callable[[dict[str, Any] | None], bool] | None = None,
    ) -> None:
        needle = search_text.strip().casefold()
        visible = 0
        for row in range(self.rowCount()):
            asset = self.get_asset_from_row(row)
            matches_text = not needle or any(
                needle in self.item(row, column).text().casefold()
                for column in range(self.columnCount())
                if self.item(row, column) is not None
            )
            matches = matches_text and (predicate(asset) if predicate else True)
            self.setRowHidden(row, not matches)
            visible += int(matches)
        self.counts_changed.emit(visible, self.rowCount())


class MainWindow(QMainWindow):
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
        self.settings_manager = SettingsManager() if SettingsManager else None
        self.asset_repository = (
            AssetRepository(supabase_client, self.ASSET_TABLE_NAME)
            if AssetRepository
            else None
        )
        self.change_monitor = (
            InventoryChangeMonitor(supabase_client, self)
            if InventoryChangeMonitor
            else None
        )
        self.assets: list[dict[str, Any]] = []
        self.sidebar = None
        self.is_loading = False
        self._reload_pending = False

        self._reload_timer = QTimer(self)
        self._reload_timer.setSingleShot(True)
        self._reload_timer.setInterval(600)
        self._reload_timer.timeout.connect(self._run_scheduled_reload)

        self.setWindowTitle("ITAssetFlow")
        self.resize(self.DEFAULT_WIDTH, self.DEFAULT_HEIGHT)
        self.setDockNestingEnabled(True)
        self.setDockOptions(
            self.dockOptions()
            | QMainWindow.DockOption.AnimatedDocks
            | QMainWindow.DockOption.AllowNestedDocks
        )

        self._create_actions()
        self._create_menu_bar()
        self._create_central_area()
        self._create_sidebar()
        self._create_status_bar()
        self._connect_signals()
        self._apply_theme()
        self._restore_window_settings()
        QTimer.singleShot(0, self._initial_load)

    def _create_actions(self) -> None:
        # Kein Button mehr in der Seitenleiste. F5 bleibt als manueller
        # Notfall-/Supportweg erhalten.
        self.refresh_action = QAction("Jetzt aktualisieren", self)
        self.refresh_action.setShortcut("F5")
        self.refresh_action.triggered.connect(self.load_assets)

        self.sidebar_visible_action = QAction("Seitenleiste anzeigen", self)
        self.sidebar_visible_action.setCheckable(True)
        self.sidebar_visible_action.setChecked(True)
        self.sidebar_visible_action.toggled.connect(self.set_sidebar_visible)

        self.sidebar_left_action = QAction("Links andocken", self)
        self.sidebar_left_action.triggered.connect(self.dock_sidebar_left)

        self.sidebar_right_action = QAction("Rechts andocken", self)
        self.sidebar_right_action.triggered.connect(self.dock_sidebar_right)

        self.sidebar_float_action = QAction("Seitenleiste lösen", self)
        self.sidebar_float_action.triggered.connect(self.float_sidebar)

        self.exit_action = QAction("Beenden", self)
        self.exit_action.setShortcut("Ctrl+Q")
        self.exit_action.triggered.connect(self.close)

        self.about_action = QAction("Über ITAssetFlow", self)
        self.about_action.triggered.connect(self.show_about_dialog)

    def _create_menu_bar(self) -> None:
        menu_bar = self.menuBar()
        menu_bar.setNativeMenuBar(False)

        file_menu = menu_bar.addMenu("Datei")
        file_menu.addAction(self.refresh_action)
        file_menu.addSeparator()
        file_menu.addAction(self.exit_action)

        options_menu = menu_bar.addMenu("Optionen")
        sidebar_menu = options_menu.addMenu("Seitenleiste")
        sidebar_menu.addAction(self.sidebar_visible_action)
        sidebar_menu.addSeparator()
        sidebar_menu.addAction(self.sidebar_left_action)
        sidebar_menu.addAction(self.sidebar_right_action)
        sidebar_menu.addAction(self.sidebar_float_action)

        options_menu.addSeparator()
        self.columns_menu = QMenu("Spalten", self)
        options_menu.addMenu(self.columns_menu)

        menu_bar.addMenu("Hilfe").addAction(self.about_action)

    def _create_central_area(self) -> None:
        central_widget = QWidget(self)
        layout = QVBoxLayout(central_widget)
        layout.setContentsMargins(20, 18, 20, 20)
        layout.setSpacing(12)

        header = QHBoxLayout()
        title = QLabel("IT-Inventar")
        title.setObjectName("pageTitle")
        self.record_count_label = QLabel("Keine Daten geladen")
        self.record_count_label.setObjectName("recordCountLabel")
        self.record_count_label.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        header.addWidget(title)
        header.addStretch()
        header.addWidget(self.record_count_label)

        table_class = AssetTableWidget or BasicAssetTable
        self.asset_table = table_class(self.columns_menu, self)
        layout.addLayout(header)
        layout.addWidget(self.asset_table)
        self.setCentralWidget(central_widget)

    def _create_sidebar(self) -> None:
        if InventorySidebar is None:
            for action in (
                self.sidebar_visible_action,
                self.sidebar_left_action,
                self.sidebar_right_action,
                self.sidebar_float_action,
            ):
                action.setEnabled(False)
            logger.error(
                "Die Seitenleiste konnte nicht importiert werden. "
                "Prüfe ui/inventory_sidebar.py und inventory.py."
            )
            return

        self.sidebar = InventorySidebar(self)
        self._last_sidebar_area = Qt.DockWidgetArea.LeftDockWidgetArea
        self.addDockWidget(self._last_sidebar_area, self.sidebar)
        self.sidebar.show()

        self.sidebar.topLevelChanged.connect(self._sidebar_floating_changed)
        self.sidebar.dockLocationChanged.connect(self._sidebar_location_changed)
        self.sidebar.visibilityChanged.connect(self._sidebar_visibility_changed)

    def _create_status_bar(self) -> None:
        self.statusBar().showMessage("Bereit")
        user_label = QLabel(f"Angemeldet: {self.authenticated_email}")
        user_label.setObjectName("userStatusLabel")
        self.statusBar().addPermanentWidget(user_label)

    def _connect_signals(self) -> None:
        self.asset_table.itemSelectionChanged.connect(self._selection_changed)
        self.asset_table.counts_changed.connect(self._update_count_labels)

        visible_signal = getattr(self.asset_table, "visible_columns_changed", None)
        if visible_signal is not None:
            visible_signal.connect(self.apply_filter)
        rejected_signal = getattr(
            self.asset_table,
            "column_visibility_rejected",
            None,
        )
        if rejected_signal is not None:
            rejected_signal.connect(
                lambda message: self.statusBar().showMessage(message, 3000)
            )

        if self.sidebar is not None:
            self.sidebar.filter_changed.connect(self.apply_filter)
            self.sidebar.create_requested.connect(self.show_create_asset_placeholder)
            self.sidebar.edit_requested.connect(self.show_edit_asset_placeholder)
            self.sidebar.delete_requested.connect(self.show_delete_asset_placeholder)

        if self.change_monitor is not None:
            self.change_monitor.changed.connect(self.schedule_inventory_reload)
            self.change_monitor.mode_changed.connect(
                self._change_monitor_mode_changed
            )

    @Slot()
    def _initial_load(self) -> None:
        self.load_assets()
        if self.change_monitor is not None:
            self.change_monitor.start()

    @Slot()
    def load_assets(self) -> None:
        if self.is_loading:
            self._reload_pending = True
            return

        self._set_loading_state(True)
        self.statusBar().showMessage("Inventardaten werden geladen ...")
        try:
            self.assets, categories = self._load_inventory()
            if self.sidebar is not None:
                self.sidebar.rebuild_category_filter(self.assets, categories)
            self.asset_table.populate_assets(self.assets)
            self.apply_filter()
            self._selection_changed()

            repository_warning = (
                getattr(self.asset_repository, "catalog_warning", None)
                if self.asset_repository is not None
                else None
            )
            if repository_warning:
                logger.warning(
                    "Inventar wurde mit Zusatzdaten-Warnungen geladen: %s",
                    repository_warning,
                )
                self.statusBar().showMessage(
                    f"{len(self.assets)} Datensätze geladen; "
                    "einige Zusatzdaten sind nicht lesbar. Siehe Log.",
                    8000,
                )
            else:
                self.statusBar().showMessage(
                    f"{len(self.assets)} Datensätze geladen.",
                    3500,
                )
        except Exception as error:
            logger.exception("Inventardaten konnten nicht geladen werden.")
            self.assets = []
            self.asset_table.clear_assets()
            QMessageBox.critical(
                self,
                "Supabase-Fehler",
                "Die Inventardaten konnten nicht geladen werden.\n\n"
                f"Tabelle: {self.ASSET_TABLE_NAME}\n\nFehler:\n{error}",
            )
        finally:
            self._set_loading_state(False)
            if self._reload_pending:
                self._reload_pending = False
                self.schedule_inventory_reload()

    def _load_inventory(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if self.asset_repository is not None:
            return self.asset_repository.load_inventory()
        response = (
            self.supabase_client
            .table(self.ASSET_TABLE_NAME)
            .select("*")
            .order("id")
            .execute()
        )
        assets = [row for row in (response.data or []) if isinstance(row, dict)]
        return assets, []

    @Slot()
    def schedule_inventory_reload(self) -> None:
        """Bündelt mehrere schnelle Änderungen zu genau einem Reload."""
        if self.is_loading:
            self._reload_pending = True
            return
        self._reload_timer.start()

    @Slot()
    def _run_scheduled_reload(self) -> None:
        if self.is_loading:
            self._reload_pending = True
            return
        self.statusBar().showMessage(
            "Änderung erkannt – Inventar wird aktualisiert ..."
        )
        self.load_assets()

    def notify_inventory_changed(self) -> None:
        """Von Create/Edit/Delete-Dialogen nach erfolgreichem Speichern aufrufen.

        Dadurch wird lokal sofort aktualisiert; der Cloud-Monitor dient zusätzlich
        für Änderungen anderer Clients.
        """
        if self.change_monitor is not None:
            self.change_monitor.notify_local_change()
        else:
            self.schedule_inventory_reload()

    @Slot(str)
    def _change_monitor_mode_changed(self, mode: str) -> None:
        if mode == "revision":
            self.statusBar().showMessage(
                "Automatische Cloud-Aktualisierung aktiv.",
                5000,
            )
        else:
            self.statusBar().showMessage(
                "Cloud-Änderungstabelle nicht verfügbar: "
                "Fallback-Aktualisierung alle 60 Sekunden.",
                9000,
            )

    @Slot()
    def apply_filter(self) -> None:
        search_text = self.sidebar.search_text if self.sidebar is not None else ""
        predicate = self.sidebar.matches if self.sidebar is not None else None
        self.asset_table.filter_rows(search_text, predicate)

    @Slot(bool)
    def set_sidebar_visible(self, visible: bool) -> None:
        if self.sidebar is None:
            return
        self.sidebar.setVisible(visible)
        if visible:
            self.sidebar.raise_()

    @Slot()
    def dock_sidebar_left(self) -> None:
        self._dock_sidebar(Qt.DockWidgetArea.LeftDockWidgetArea)

    @Slot()
    def dock_sidebar_right(self) -> None:
        self._dock_sidebar(Qt.DockWidgetArea.RightDockWidgetArea)

    def _dock_sidebar(self, area: Qt.DockWidgetArea) -> None:
        if self.sidebar is None:
            return
        self._last_sidebar_area = area
        self.sidebar.setFloating(False)
        self.addDockWidget(area, self.sidebar)
        self.sidebar.show()
        self.sidebar.raise_()

    @Slot()
    def float_sidebar(self) -> None:
        if self.sidebar is None:
            return
        self.sidebar.setFloating(True)
        self.sidebar.show()
        self.sidebar.raise_()

    @Slot()
    def toggle_sidebar_floating(self) -> None:
        if self.sidebar is None:
            return
        if self.sidebar.isFloating():
            self._dock_sidebar(self._last_sidebar_area)
        else:
            self.float_sidebar()

    @Slot(bool)
    def _sidebar_floating_changed(self, floating: bool) -> None:
        self.sidebar_float_action.setEnabled(not floating)
        self.sidebar_left_action.setEnabled(True)
        self.sidebar_right_action.setEnabled(True)

    @Slot(Qt.DockWidgetArea)
    def _sidebar_location_changed(self, area: Qt.DockWidgetArea) -> None:
        if area in (
            Qt.DockWidgetArea.LeftDockWidgetArea,
            Qt.DockWidgetArea.RightDockWidgetArea,
        ):
            self._last_sidebar_area = area

    @Slot(bool)
    def _sidebar_visibility_changed(self, visible: bool) -> None:
        self.sidebar_visible_action.blockSignals(True)
        self.sidebar_visible_action.setChecked(visible)
        self.sidebar_visible_action.blockSignals(False)

    @Slot()
    def _selection_changed(self) -> None:
        if self.sidebar is None:
            return
        identifiers = [
            get_asset_identifier(asset)
            for asset in self.asset_table.get_selected_assets()
        ]
        self.sidebar.set_selection(identifiers)

    @Slot(int, int)
    def _update_count_labels(self, visible: int, total: int) -> None:
        text = (
            f"{total} Datensätze"
            if visible == total
            else f"{visible} von {total} Datensätzen"
        )
        self.record_count_label.setText(text)
        if self.sidebar is not None:
            self.sidebar.set_count_text(text)

    def _set_loading_state(self, loading: bool) -> None:
        self.is_loading = loading
        self.refresh_action.setEnabled(not loading)
        if self.sidebar is not None:
            self.sidebar.set_loading_state(loading)

    @Slot()
    def show_create_asset_placeholder(self) -> None:
        QMessageBox.information(
            self,
            "Neues Asset",
            "Diese Funktion wird im nächsten Schritt ergänzt.",
        )

    @Slot()
    def show_edit_asset_placeholder(self) -> None:
        asset = self.asset_table.get_selected_asset()
        if asset is None:
            QMessageBox.information(
                self,
                "Asset bearbeiten",
                "Bitte genau ein Asset auswählen.",
            )
            return
        QMessageBox.information(
            self,
            "Asset bearbeiten",
            "Diese Funktion wird im nächsten Schritt ergänzt.\n\n"
            f"Ausgewählt: {get_asset_identifier(asset)}",
        )

    @Slot()
    def show_delete_asset_placeholder(self) -> None:
        assets = self.asset_table.get_selected_assets()
        if not assets:
            QMessageBox.information(
                self,
                "Assets löschen",
                "Bitte zuerst mindestens ein Asset auswählen.",
            )
            return
        identifiers = [get_asset_identifier(asset) for asset in assets[:5]]
        text = "\n".join(f"• {identifier}" for identifier in identifiers)
        if len(assets) > 5:
            text += f"\n• … und {len(assets) - 5} weitere"
        QMessageBox.information(
            self,
            "Assets löschen",
            "Diese Funktion wird im nächsten Schritt ergänzt.\n\n"
            f"{len(assets)} Assets ausgewählt:\n{text}",
        )

    @Slot()
    def show_about_dialog(self) -> None:
        QMessageBox.about(
            self,
            "Über ITAssetFlow",
            "<h2>ITAssetFlow</h2>"
            "<p>Inventarverwaltung für IT-Materialien.</p>"
            "<p>Datenbank und Authentifizierung über Supabase.</p>"
            "<p>DLC-Informatik GmbH</p>",
        )

    def _apply_theme(self) -> None:
        if apply_light_theme is not None:
            apply_light_theme(self)

    def _restore_window_settings(self) -> None:
        if self.settings_manager is None:
            return
        geometry = self.settings_manager.load_window_geometry()
        if geometry:
            self.restoreGeometry(geometry)
        if not self._is_on_available_screen():
            self._move_to_primary_screen()
        if self.settings_manager.load_window_maximized():
            self.showMaximized()

    def _is_on_available_screen(self) -> bool:
        geometry = self.frameGeometry()
        return any(
            screen.availableGeometry().intersects(geometry)
            for screen in QGuiApplication.screens()
        )

    def _move_to_primary_screen(self) -> None:
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            return
        self.resize(self.DEFAULT_WIDTH, self.DEFAULT_HEIGHT)
        geometry = screen.availableGeometry()
        self.move(
            geometry.x() + (geometry.width() - self.width()) // 2,
            geometry.y() + (geometry.height() - self.height()) // 2,
        )

    def closeEvent(self, event: QCloseEvent) -> None:
        if self.change_monitor is not None:
            self.change_monitor.stop()
        if self.settings_manager is not None:
            self.settings_manager.save_window_geometry(self.saveGeometry())
            self.settings_manager.save_window_maximized(self.isMaximized())
        event.accept()