from PySide6.QtGui import QCloseEvent, QGuiApplication
from PySide6.QtWidgets import QMainWindow

from settings_manager import SettingsManager


class MainWindow(QMainWindow):
    DEFAULT_WIDTH = 1200
    DEFAULT_HEIGHT = 750

    def __init__(self) -> None:
        super().__init__()

        self.settings_manager = SettingsManager()

        self.setWindowTitle("AssetFlow IT")
        self.resize(
            self.DEFAULT_WIDTH,
            self.DEFAULT_HEIGHT,
        )

        self.restore_window_settings()

    def restore_window_settings(self) -> None:
        geometry = self.settings_manager.load_window_geometry()

        if geometry:
            self.restoreGeometry(geometry)

        if not self.is_on_available_screen():
            self.move_to_primary_screen()

        if self.settings_manager.load_window_maximized():
            self.showMaximized()

    def is_on_available_screen(self) -> bool:
        window_geometry = self.frameGeometry()

        for screen in QGuiApplication.screens():
            if screen.availableGeometry().intersects(window_geometry):
                return True

        return False

    def move_to_primary_screen(self) -> None:
        screen = QGuiApplication.primaryScreen()

        if screen is None:
            return

        self.resize(
            self.DEFAULT_WIDTH,
            self.DEFAULT_HEIGHT,
        )

        screen_geometry = screen.availableGeometry()

        x = (
            screen_geometry.x()
            + (screen_geometry.width() - self.width()) // 2
        )

        y = (
            screen_geometry.y()
            + (screen_geometry.height() - self.height()) // 2
        )

        self.move(x, y)

    def closeEvent(self, event: QCloseEvent) -> None:
        self.settings_manager.save_window_geometry(
            self.saveGeometry()
        )

        self.settings_manager.save_window_maximized(
            self.isMaximized()
        )

        event.accept()