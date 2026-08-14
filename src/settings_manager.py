from __future__ import annotations

from PySide6.QtCore import QByteArray, QSettings


class SettingsManager:
    """Kleine zentrale Hülle um die lokalen Qt-Benutzereinstellungen."""

    def __init__(self) -> None:
        # Verwendet ApplicationName/OrganizationName aus main.py.
        self.settings = QSettings()

    def save_window_geometry(self, geometry: QByteArray) -> None:
        self.settings.setValue("window/geometry", geometry)

    def load_window_geometry(self) -> QByteArray | None:
        value = self.settings.value("window/geometry")
        return value if isinstance(value, QByteArray) else None

    def save_window_state(self, state: QByteArray) -> None:
        self.settings.setValue("window/state", state)

    def load_window_state(self) -> QByteArray | None:
        value = self.settings.value("window/state")
        return value if isinstance(value, QByteArray) else None

    def save_window_maximized(self, maximized: bool) -> None:
        self.settings.setValue("window/maximized", maximized)

    def load_window_maximized(self) -> bool:
        return self.settings.value(
            "window/maximized",
            False,
            type=bool,
        )
