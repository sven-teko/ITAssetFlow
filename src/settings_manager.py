from PySide6.QtCore import QSettings


class SettingsManager:
    def __init__(self) -> None:
        self.settings = QSettings(
            "DLC-Informatik GmbH",
            "AssetFlow IT",
        )

    def save_window_geometry(self, geometry) -> None:
        self.settings.setValue("window/geometry", geometry)

    def load_window_geometry(self):
        return self.settings.value("window/geometry")

    def save_window_maximized(self, maximized: bool) -> None:
        self.settings.setValue("window/maximized", maximized)

    def load_window_maximized(self) -> bool:
        return self.settings.value(
            "window/maximized",
            False,
            type=bool,
        )