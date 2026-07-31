import logging
import sys

from PySide6.QtWidgets import QApplication

from infrastructure.supabase_client import test_connection
from logging_config import setup_logging
from ui.main_window import MainWindow


logger = logging.getLogger(__name__)


def main() -> None:
    setup_logging()

    logger.info("Starting AssetFlow IT...")

    app = QApplication(sys.argv)

    app.setApplicationName("AssetFlow IT")
    app.setOrganizationName("DLC-Informatik GmbH")

    if test_connection():
        logger.info("Supabase is available.")
    else:
        logger.warning("Supabase is currently unavailable.")

    window = MainWindow()
    window.show()

    logger.info("Main window opened.")

    sys.exit(app.exec())


if __name__ == "__main__":
    main()