from __future__ import annotations

import logging
from typing import Any, Callable

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


class _TaskSignals(QObject):
    succeeded = Signal(object)
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


class _RepositoryTaskWorker(QRunnable):
    """Kleine generische Hülle für weitere Repository-Aufrufe."""

    def __init__(self, task: Callable[[], Any]) -> None:
        super().__init__()
        self.task = task
        self.signals = _TaskSignals()

    @Slot()
    def run(self) -> None:
        try:
            result = self.task()
        except Exception as error:
            logger.exception("Repository-Aktion fehlgeschlagen.")
            self.signals.failed.emit(str(error))
            return
        self.signals.succeeded.emit(result)


class InventoryViewController(QObject):
    """Steuert Laden, Schreiben, Reload-Bündelung und Cloud-Aktualisierung.

    Die Klasse kennt keine Widgets. Sämtliche blockierenden Supabase-Zugriffe
    laufen über einen einzelnen Hintergrund-Thread. Dadurch bleibt die Qt-UI
    bedienbar und die gemeinsame Supabase-Client-Instanz wird nicht gleichzeitig
    aus mehreren Worker-Threads verwendet.
    """

    inventory_loaded = Signal(object)
    loading_changed = Signal(bool)
    load_failed = Signal(str)
    status_message = Signal(str, int)

    create_form_loaded = Signal(object)
    create_form_failed = Signal(str)
    entry_created = Signal(object)
    entry_create_failed = Signal(str)

    entries_deleted = Signal(object)
    entries_delete_failed = Signal(str)

    writing_changed = Signal(bool)

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

        # Ein Worker reicht: sämtliche Supabase-Zugriffe dieses Controllers
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
        self._is_writing = False
        self._create_form_loading = False
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

    @property
    def is_writing(self) -> bool:
        return self._is_writing

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

    # ------------------------------------------------------------------
    # Inventar laden
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Neuer Eintrag
    # ------------------------------------------------------------------

    @Slot()
    def load_create_form_data(self) -> None:
        if self._create_form_loading:
            return

        self._create_form_loading = True
        self.status_message.emit(
            "Stammdaten für den neuen Eintrag werden geladen ...",
            0,
        )

        worker = _RepositoryTaskWorker(self.repository.load_create_form_data)
        worker.signals.succeeded.connect(self._create_form_data_loaded)
        worker.signals.failed.connect(self._create_form_data_failed)
        self._thread_pool.start(worker)

    @Slot(object)
    def _create_form_data_loaded(self, data: object) -> None:
        self._create_form_loading = False
        self.status_message.emit("Eingabefenster bereit.", 2500)
        self.create_form_loaded.emit(data)

    @Slot(str)
    def _create_form_data_failed(self, message: str) -> None:
        self._create_form_loading = False
        self.status_message.emit("Stammdaten konnten nicht geladen werden.", 5000)
        self.create_form_failed.emit(message)

    @Slot(object)
    def create_inventory_entry(self, payload: object) -> None:
        if self._is_writing:
            return
        if not isinstance(payload, dict):
            self.entry_create_failed.emit("Ungültige Formulardaten.")
            return

        self._set_writing(True)
        self.status_message.emit("Inventareintrag wird gespeichert ...", 0)

        worker = _RepositoryTaskWorker(
            lambda: self.repository.create_inventory_entry(payload)
        )
        worker.signals.succeeded.connect(self._entry_created)
        worker.signals.failed.connect(self._entry_create_failed)
        self._thread_pool.start(worker)

    @Slot(object)
    def _entry_created(self, result: object) -> None:
        self._set_writing(False)
        self.entry_created.emit(result)
        self.status_message.emit("Inventareintrag wurde gespeichert.", 4000)

        # Sofortigen Reload anfordern. Der ChangeMonitor bündelt dies mit
        # allfälligen Trigger-/Cloud-Signalen.
        self.notify_inventory_changed()

    @Slot(str)
    def _entry_create_failed(self, message: str) -> None:
        self._set_writing(False)
        self.status_message.emit("Inventareintrag konnte nicht gespeichert werden.", 6000)
        self.entry_create_failed.emit(message)

    # ------------------------------------------------------------------
    # Einträge löschen
    # ------------------------------------------------------------------

    @Slot(object)
    def delete_inventory_entries(
        self,
        entries: object,
    ) -> None:
        if self._is_writing:
            return

        if not isinstance(entries, list) or not entries:
            self.entries_delete_failed.emit(
                "Keine Inventareinträge zum Löschen ausgewählt."
            )
            return

        selected = [
            entry
            for entry in entries
            if isinstance(entry, dict)
        ]
        if not selected:
            self.entries_delete_failed.emit(
                "Die ausgewählten Inventareinträge sind ungültig."
            )
            return

        self._set_writing(True)

        count = len(selected)
        self.status_message.emit(
            (
                "Inventareintrag wird gelöscht ..."
                if count == 1
                else f"{count} Inventareinträge werden gelöscht ..."
            ),
            0,
        )

        worker = _RepositoryTaskWorker(
            lambda: self.repository.delete_inventory_entries(
                selected
            )
        )
        worker.signals.succeeded.connect(
            self._entries_deleted
        )
        worker.signals.failed.connect(
            self._entries_delete_failed
        )
        self._thread_pool.start(worker)

    @Slot(object)
    def _entries_deleted(
        self,
        result: object,
    ) -> None:
        self._set_writing(False)
        self.entries_deleted.emit(result)
        self.status_message.emit(
            "Ausgewählte Inventareinträge wurden gelöscht.",
            4500,
        )
        self.notify_inventory_changed()

    @Slot(str)
    def _entries_delete_failed(
        self,
        message: str,
    ) -> None:
        self._set_writing(False)
        self.status_message.emit(
            "Inventareinträge konnten nicht gelöscht werden.",
            6500,
        )
        self.entries_delete_failed.emit(message)

    # ------------------------------------------------------------------
    # Reload / Cloud-Monitor
    # ------------------------------------------------------------------

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

    def _set_writing(self, writing: bool) -> None:
        if self._is_writing == writing:
            return
        self._is_writing = writing
        self.writing_changed.emit(writing)