from PySide6.QtWidgets import QLabel, QMainWindow
from PySide6.QtCore import Qt


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()

        self.setWindowTitle("AssetFlow IT")
        self.resize(1200, 700)

        label = QLabel("AssetFlow IT")
        label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.setCentralWidget(label)