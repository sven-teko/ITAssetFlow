from __future__ import annotations

from PySide6.QtCore import QObject, Signal, Slot
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QMainWindow, QMenu


class MainWindowMenu(QObject):
    """Erzeugt und verwaltet Menüleiste und MainWindow-Aktionen.

    Die Klasse enthält bewusst keine fachliche Logik. Sie stellt Signale bereit,
    auf die MainWindow bzw. DockManager reagieren können.
    """

    refresh_requested = Signal()
    exit_requested = Signal()
    about_requested = Signal()
    settings_requested = Signal()

    import_csv_requested = Signal()
    import_postgresql_requested = Signal()
    export_csv_requested = Signal()
    export_postgresql_requested = Signal()

    navigation_visibility_requested = Signal(bool)
    navigation_left_requested = Signal()
    navigation_right_requested = Signal()
    navigation_float_requested = Signal()

    detail_visibility_requested = Signal(bool)
    detail_left_requested = Signal()
    detail_right_requested = Signal()
    detail_float_requested = Signal()

    def __init__(
        self,
        window: QMainWindow,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent or window)
        self.window = window

        self._create_actions()
        self._create_menu_bar()
        self._connect_actions()

    # ------------------------------------------------------------------
    # Aufbau
    # ------------------------------------------------------------------

    def _create_actions(self) -> None:
        self.refresh_action = QAction(
            "Jetzt aktualisieren",
            self.window,
        )
        self.refresh_action.setShortcut("F5")

        self.navigation_visible_action = QAction(
            "Navigation anzeigen",
            self.window,
        )
        self.navigation_visible_action.setCheckable(True)
        self.navigation_visible_action.setChecked(True)

        self.navigation_left_action = QAction(
            "Links andocken",
            self.window,
        )
        self.navigation_right_action = QAction(
            "Rechts andocken",
            self.window,
        )
        self.navigation_float_action = QAction(
            "Navigation lösen",
            self.window,
        )

        self.detail_visible_action = QAction(
            "Detailansicht anzeigen",
            self.window,
        )
        self.detail_visible_action.setCheckable(True)
        self.detail_visible_action.setChecked(True)

        self.detail_left_action = QAction(
            "Links andocken",
            self.window,
        )
        self.detail_right_action = QAction(
            "Rechts andocken",
            self.window,
        )
        self.detail_float_action = QAction(
            "Detailansicht lösen",
            self.window,
        )

        self.import_csv_action = QAction(
            "CSV",
            self.window,
        )
        self.import_postgresql_action = QAction(
            "PostgreSQL",
            self.window,
        )
        self.export_csv_action = QAction(
            "CSV",
            self.window,
        )
        self.export_postgresql_action = QAction(
            "PostgreSQL",
            self.window,
        )

        self.settings_action = QAction(
            "Einstellungen",
            self.window,
        )

        self.exit_action = QAction(
            "Beenden",
            self.window,
        )
        self.exit_action.setShortcut("Ctrl+Q")

        self.about_action = QAction(
            "Über",
            self.window,
        )

    def _create_menu_bar(self) -> None:
        menu_bar = self.window.menuBar()
        menu_bar.setNativeMenuBar(False)

        file_menu = menu_bar.addMenu("Datei")
        file_menu.addAction(self.refresh_action)
        file_menu.addSeparator()

        import_menu = file_menu.addMenu("Import")
        import_menu.addAction(self.import_csv_action)
        import_menu.addAction(self.import_postgresql_action)

        export_menu = file_menu.addMenu("Export")
        export_menu.addAction(self.export_csv_action)
        export_menu.addAction(self.export_postgresql_action)

        file_menu.addSeparator()
        file_menu.addAction(self.settings_action)
        file_menu.addSeparator()
        file_menu.addAction(self.exit_action)

        options_menu = menu_bar.addMenu("Optionen")

        navigation_menu = options_menu.addMenu("Navigation")
        navigation_menu.addAction(
            self.navigation_visible_action
        )
        navigation_menu.addSeparator()
        navigation_menu.addAction(
            self.navigation_left_action
        )
        navigation_menu.addAction(
            self.navigation_right_action
        )
        navigation_menu.addAction(
            self.navigation_float_action
        )

        detail_menu = options_menu.addMenu("Detailansicht")
        detail_menu.addAction(
            self.detail_visible_action
        )
        detail_menu.addSeparator()
        detail_menu.addAction(
            self.detail_left_action
        )
        detail_menu.addAction(
            self.detail_right_action
        )
        detail_menu.addAction(
            self.detail_float_action
        )

        options_menu.addSeparator()

        # Wird vom AssetTableWidget verwendet.
        self.columns_menu = QMenu(
            "Spalten",
            self.window,
        )
        options_menu.addMenu(self.columns_menu)

        help_menu = menu_bar.addMenu("Hilfe")
        help_menu.addAction(self.about_action)

    def _connect_actions(self) -> None:
        self.refresh_action.triggered.connect(
            lambda _checked=False: self.refresh_requested.emit()
        )
        self.import_csv_action.triggered.connect(
            lambda _checked=False: self.import_csv_requested.emit()
        )
        self.import_postgresql_action.triggered.connect(
            lambda _checked=False: self.import_postgresql_requested.emit()
        )
        self.export_csv_action.triggered.connect(
            lambda _checked=False: self.export_csv_requested.emit()
        )
        self.export_postgresql_action.triggered.connect(
            lambda _checked=False: self.export_postgresql_requested.emit()
        )

        self.settings_action.triggered.connect(
            lambda _checked=False: self.settings_requested.emit()
        )
        self.exit_action.triggered.connect(
            lambda _checked=False: self.exit_requested.emit()
        )
        self.about_action.triggered.connect(
            lambda _checked=False: self.about_requested.emit()
        )

        self.navigation_visible_action.toggled.connect(
            self.navigation_visibility_requested.emit
        )
        self.navigation_left_action.triggered.connect(
            lambda _checked=False: self.navigation_left_requested.emit()
        )
        self.navigation_right_action.triggered.connect(
            lambda _checked=False: self.navigation_right_requested.emit()
        )
        self.navigation_float_action.triggered.connect(
            lambda _checked=False: self.navigation_float_requested.emit()
        )

        self.detail_visible_action.toggled.connect(
            self.detail_visibility_requested.emit
        )
        self.detail_left_action.triggered.connect(
            lambda _checked=False: self.detail_left_requested.emit()
        )
        self.detail_right_action.triggered.connect(
            lambda _checked=False: self.detail_right_requested.emit()
        )
        self.detail_float_action.triggered.connect(
            lambda _checked=False: self.detail_float_requested.emit()
        )

    # ------------------------------------------------------------------
    # Zustände aus MainWindow / DockManager spiegeln
    # ------------------------------------------------------------------

    @Slot(bool)
    def set_navigation_visible_checked(
        self,
        visible: bool,
    ) -> None:
        self.navigation_visible_action.blockSignals(True)
        self.navigation_visible_action.setChecked(visible)
        self.navigation_visible_action.blockSignals(False)

    @Slot(bool)
    def set_detail_visible_checked(
        self,
        visible: bool,
    ) -> None:
        self.detail_visible_action.blockSignals(True)
        self.detail_visible_action.setChecked(visible)
        self.detail_visible_action.blockSignals(False)

    @Slot(bool)
    def set_navigation_floating(
        self,
        floating: bool,
    ) -> None:
        self.navigation_float_action.setEnabled(
            not floating
        )

    @Slot(bool)
    def set_detail_floating(
        self,
        floating: bool,
    ) -> None:
        self.detail_float_action.setEnabled(
            not floating
        )

    @Slot(bool)
    def set_loading_state(
        self,
        loading: bool,
    ) -> None:
        self.refresh_action.setEnabled(
            not loading
        )
        self.settings_action.setEnabled(
            not loading
        )

        for action in (
            self.import_csv_action,
            self.import_postgresql_action,
            self.export_csv_action,
            self.export_postgresql_action,
        ):
            action.setEnabled(
                not loading
            )