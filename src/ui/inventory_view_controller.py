from __future__ import annotations

import logging
from typing import Any

from PySide6.QtCore import QObject, QTimer, Signal, Slot
from supabase import Client

from infrastructure.asset_repository import AssetRepository
from infrastructure.inventory_change_monitor import (
    InventoryChangeMonitor,
)


logger = logging.getLogger(__name__)


class InventoryViewController(QObject):
    """Steuert Laden und automatische Aktualisierung des Inventars.

    Aufgaben:
    - Inventardaten (Assets + Mengenbestand) über AssetRepository laden
    - Cloud-Änderungen über InventoryChangeMonitor beobachten
    - schnelle Reload-Anforderungen bündeln
    - Loading-, Status- und Fehlerzustände an die UI melden

    Die Klasse kennt keine Widgets und kann dadurch unabhängig von MainWindow
    weiterentwickelt und getestet werden.
    """

    inventory_loaded = Signal(object, object)
    loading_changed = Signal(bool)
    load_failed = Signal(str)
    status_message = Signal(str, int)

    RELOAD_DELAY_MS = 600

    def __init__(
        self,
        client: Client,
        *,
        asset_table_name: str = "assets",
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)

        self.client = client
        self.asset_table_name = asset_table_name

        self.repository = AssetRepository(
            client,
            asset_table_name,
        )
        self.change_monitor = InventoryChangeMonitor(
            client,
            self,
        )

        self.assets: list[dict[str, Any]] = []
        self.categories: list[dict[str, Any]] = []

        self._is_loading = False
        self._reload_pending = False
        self._started = False

        self._reload_timer = QTimer(self)
        self._reload_timer.setSingleShot(True)
        self._reload_timer.setInterval(
            self.RELOAD_DELAY_MS
        )
        self._reload_timer.timeout.connect(
            self._run_scheduled_reload
        )

        self.change_monitor.changed.connect(
            self.schedule_reload
        )
        self.change_monitor.mode_changed.connect(
            self._monitor_mode_changed
        )

    @property
    def is_loading(self) -> bool:
        return self._is_loading

    @Slot()
    def start(self) -> None:
        """Startet initiales Laden und anschließend den Cloud-Monitor."""

        if self._started:
            return

        self._started = True
        self.load_inventory()
        self.change_monitor.start()

    @Slot()
    def stop(self) -> None:
        """Stoppt Timer und Cloud-Monitor beim Beenden der Anwendung."""

        self._reload_timer.stop()
        self.change_monitor.stop()
        self._started = False

    @Slot()
    def load_inventory(self) -> None:
        if self._is_loading:
            self._reload_pending = True
            return

        self._set_loading(True)
        self.status_message.emit(
            "Inventardaten werden geladen ...",
            0,
        )

        try:
            assets, categories = (
                self.repository.load_inventory()
            )

            self.assets = assets
            self.categories = categories

            self.inventory_loaded.emit(
                self.assets,
                self.categories,
            )

            warning = self.repository.catalog_warning

            if warning:
                logger.warning(
                    "Inventar wurde mit Zusatzdaten-Warnungen geladen: %s",
                    warning,
                )
                self.status_message.emit(
                    f"{len(self.assets)} Inventareinträge geladen; "
                    "einige Zusatzdaten sind nicht lesbar. Siehe Log.",
                    8000,
                )
            else:
                self.status_message.emit(
                    f"{len(self.assets)} Inventareinträge geladen.",
                    3500,
                )

        except Exception as error:
            logger.exception(
                "Inventardaten konnten nicht geladen werden."
            )

            self.assets = []
            self.categories = []

            message = (
                "Die Inventardaten konnten nicht geladen werden.\n\n"
                f"Tabelle: {self.asset_table_name}\n\n"
                f"Fehler:\n{error}"
            )
            self.load_failed.emit(message)

        finally:
            self._set_loading(False)

            if self._reload_pending:
                self._reload_pending = False
                self.schedule_reload()

    @Slot()
    def schedule_reload(self) -> None:
        """Bündelt mehrere schnelle Änderungen zu einem einzigen Reload."""

        if self._is_loading:
            self._reload_pending = True
            return

        self._reload_timer.start()

    @Slot()
    def _run_scheduled_reload(self) -> None:
        if self._is_loading:
            self._reload_pending = True
            return

        self.status_message.emit(
            "Änderung erkannt – Inventar wird aktualisiert ...",
            0,
        )
        self.load_inventory()

    def notify_inventory_changed(self) -> None:
        """Nach erfolgreicher lokaler Schreibaktion aufrufen."""

        self.change_monitor.notify_local_change()

    @Slot(str)
    def _monitor_mode_changed(
        self,
        mode: str,
    ) -> None:
        if mode == "revision":
            self.status_message.emit(
                "Automatische Cloud-Aktualisierung aktiv.",
                5000,
            )
            return

        self.status_message.emit(
            "Cloud-Änderungstabelle nicht verfügbar: "
            "Fallback-Aktualisierung alle 60 Sekunden.",
            9000,
        )

    def _set_loading(
        self,
        loading: bool,
    ) -> None:
        if self._is_loading == loading:
            return

        self._is_loading = loading
        self.loading_changed.emit(
            loading
        )