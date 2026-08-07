from __future__ import annotations

import logging
from typing import Any, Callable

from PySide6.QtCore import QObject, QRunnable, QThreadPool, QTimer, Signal, Slot
from supabase import Client

logger = logging.getLogger(__name__)


class _WorkerSignals(QObject):
    success = Signal(object)
    failed = Signal(str)


class _RevisionWorker(QRunnable):
    def __init__(self, loader: Callable[[], int]) -> None:
        super().__init__()
        self.loader = loader
        self.signals = _WorkerSignals()

    @Slot()
    def run(self) -> None:
        try:
            revision = self.loader()
        except Exception as error:
            self.signals.failed.emit(str(error))
            return
        self.signals.success.emit(revision)


class InventoryChangeMonitor(QObject):
    """Performance-schonender Cloud-Änderungsmonitor.

    Normalbetrieb:
        alle 5 Sekunden genau eine sehr kleine SELECT-Abfrage auf
        inventory_change_state.

    Wenn die Hilfstabelle nicht eingerichtet wurde:
        nach zwei Fehlern Fallback auf eine vollständige Aktualisierung
        alle 60 Sekunden. Die Anwendung funktioniert dadurch trotzdem.
    """

    changed = Signal()
    mode_changed = Signal(str)

    NORMAL_INTERVAL_MS = 5_000
    FALLBACK_INTERVAL_MS = 60_000

    def __init__(
        self,
        client: Client,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        self.client = client
        self._last_revision: int | None = None
        self._failures = 0
        self._check_running = False
        self._fallback_mode = False
        self._active = False
        self._thread_pool = QThreadPool.globalInstance()

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)

    def start(self) -> None:
        if self._active:
            return
        self._active = True
        self._timer.setInterval(self.NORMAL_INTERVAL_MS)
        self._timer.start()
        self._check_revision()

    def stop(self) -> None:
        self._active = False
        self._timer.stop()

    def notify_local_change(self) -> None:
        """Nach erfolgreicher lokaler Schreibaktion sofort neu laden."""
        if self._active:
            self.changed.emit()

    @Slot()
    def _tick(self) -> None:
        if not self._active or self._check_running:
            return
        self._check_revision()

    def _check_revision(self) -> None:
        self._check_running = True
        worker = _RevisionWorker(self._load_revision)
        worker.signals.success.connect(self._revision_loaded)
        worker.signals.failed.connect(self._revision_failed)
        self._thread_pool.start(worker)

    def _load_revision(self) -> int:
        response = (
            self.client
            .table("inventory_change_state")
            .select("revision")
            .eq("id", 1)
            .limit(1)
            .execute()
        )
        rows = [row for row in (response.data or []) if isinstance(row, dict)]
        if not rows:
            raise RuntimeError(
                "inventory_change_state ist leer oder nicht lesbar."
            )
        return int(rows[0].get("revision") or 0)

    @Slot(object)
    def _revision_loaded(self, revision: Any) -> None:
        self._check_running = False
        self._failures = 0
        current = int(revision)

        if self._fallback_mode:
            self._fallback_mode = False
            self._timer.setInterval(self.NORMAL_INTERVAL_MS)
            self.mode_changed.emit("revision")

        if self._last_revision is None:
            self._last_revision = current
            return

        if current != self._last_revision:
            self._last_revision = current
            self.changed.emit()

    @Slot(str)
    def _revision_failed(self, message: str) -> None:
        self._check_running = False
        self._failures += 1
        logger.warning("Cloud-Änderungsprüfung fehlgeschlagen: %s", message)

        if self._failures < 2:
            return

        if not self._fallback_mode:
            self._fallback_mode = True
            self._timer.setInterval(self.FALLBACK_INTERVAL_MS)
            self.mode_changed.emit("fallback")
            return

        # Auch ohne Hilfstabelle bleibt automatische Aktualisierung möglich,
        # nur deutlich seltener und dadurch mit mehr Datenverkehr.
        self.changed.emit()