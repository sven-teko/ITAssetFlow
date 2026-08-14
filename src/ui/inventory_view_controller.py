from __future__ import annotations

import logging
from typing import Any

from PySide6.QtCore import (
    QObject,
    QRunnable,
    QThreadPool,
    QTimer,
    Signal,
    Slot,
)
from supabase import Client

from infrastructure.asset_repository import AssetRepository
from infrastructure.inventory_change_monitor import InventoryChangeMonitor


logger = logging.getLogger(__name__)


class _LoadSignals(QObject):
    succeeded = Signal(object, object)
    failed = Signal(str)


class _InventoryLoadWorker(QRunnable):
    """Führt die blockierenden Supabase-Lesezugriffe außerhalb der UI aus."""

    def __init__(self, repository: AssetRepository) -> None:
        super().__init__()
        self.repository = repository
        self.signals = _LoadSignals()

    @Slot()
    def run(self) -> None:
        try:
            assets = self.repository.load_inventory()
            warning = self.repository.catalog_warning
        except Exception as error:
            logger.exception("Inventardaten konnten nicht geladen werden.")
            self.signals.failed.emit(str(error))
            return

        self.signals.succeeded.emit(assets, warning)


class InventoryViewController(QObject):
    """Steuert Laden, Reload-Bündelung und Cloud-Aktualisierung des Inventars.

    Die Klasse kennt keine Widgets. Alle blockierenden Supabase-Lesezugriffe
    laufen über einen einzelnen Hintergrund-Thread, damit die Qt-Oberfläche
    während Netzwerkzugriffen bedienbar bleibt und der gemeinsame Supabase-
    Client nicht parallel aus mehreren Worker-Threads verwendet wird.
    """

    inventory_loaded = Signal(object)
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

        self.asset_table_name = asset_table_name
        self.repository = AssetRepository(
            client,
            asset_table_name,
        )

        # Ein Worker reicht: sämtliche Supabase-Lesezugriffe dieses Controllers
        # werden bewusst seriell ausgeführt.
        self._thread_pool = QThreadPool(self)
        self._thread_pool.setMaxThreadCount(1)

        self.change_monitor = InventoryChangeMonitor(
            client,
            thread_pool=self._thread_pool,
            parent=self,
        )

        self.assets: list[dict[str, Any]] = []
        self._is_loading = False
        self._reload_pending = False
        self._started = False

        self._reload_timer = QTimer(self)
        self._reload_timer.setSingleShot(True)
        self._reload_timer.setInterval(self.RELOAD_DELAY_MS)
        self._reload_timer.timeout.connect(self._run_scheduled_reload)

        self.change_monitor.changed.connect(self.schedule_reload)
        self.change_monitor.mode_changed.connect(self._monitor_mode_changed)

    @property
    def is_loading(self) -> bool:
        return self._is_loading

    @Slot()
    def start(self) -> None:
        if self._started:
            return

        self._started = True
        self.load_inventory()
        self.change_monitor.start()

    @Slot()
    def stop(self) -> None:
        self._started = False
        self._reload_pending = False
        self._reload_timer.stop()
        self.change_monitor.stop()
        self._thread_pool.clear()

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

        worker = _InventoryLoadWorker(self.repository)
        worker.signals.succeeded.connect(self._load_succeeded)
        worker.signals.failed.connect(self._load_failed)
        self._thread_pool.start(worker)

    @Slot(object, object)
    def _load_succeeded(
        self,
        assets: object,
        warning: object,
    ) -> None:
        self.assets = (
            [row for row in assets if isinstance(row, dict)]
            if isinstance(assets, list)
            else []
        )

        self.inventory_loaded.emit(self.assets)

        warning_text = str(warning).strip() if warning else ""
        if warning_text:
            logger.warning(
                "Inventar wurde mit Zusatzdaten-Warnungen geladen: %s",
                warning_text,
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

        self._finish_load()

    @Slot(str)
    def _load_failed(self, error_message: str) -> None:
        self.assets = []
        self.load_failed.emit(
            "Die Inventardaten konnten nicht geladen werden.\n\n"
            f"Tabelle: {self.asset_table_name}\n\n"
            f"Fehler:\n{error_message}"
        )
        self._finish_load()

    def _finish_load(self) -> None:
        self._set_loading(False)

        if self._reload_pending and self._started:
            self._reload_pending = False
            self.schedule_reload()

    @Slot()
    def schedule_reload(self) -> None:
        """Bündelt mehrere schnelle Änderungen zu einem einzigen Reload."""

        if not self._started:
            return

        if self._is_loading:
            self._reload_pending = True
            return

        self._reload_timer.start()

    @Slot()
    def _run_scheduled_reload(self) -> None:
        if self._is_loading:
            self._reload_pending = True
            return

        self.load_inventory()

    def notify_inventory_changed(self) -> None:
        """Nach erfolgreicher lokaler Schreibaktion aufrufen."""

        self.change_monitor.notify_local_change()

    @Slot(str)
    def _monitor_mode_changed(self, mode: str) -> None:
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

    def _set_loading(self, loading: bool) -> None:
        if self._is_loading == loading:
            return

        self._is_loading = loading
        self.loading_changed.emit(loading)
