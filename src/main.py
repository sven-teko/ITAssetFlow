from __future__ import annotations

import logging
import sys

from PySide6.QtWidgets import QApplication, QMessageBox
from supabase import Client

from infrastructure.supabase_client import (
    get_supabase_client,
    login_development_user,
    logout_user,
    test_authenticated_access,
)
from logging_config import setup_logging
from ui.main_window import MainWindow


logger = logging.getLogger(__name__)


def create_application() -> QApplication:
    """
    Erstellt und konfiguriert die Qt-Anwendung.
    """

    app = QApplication(sys.argv)

    app.setApplicationName("ITAssetFlow")
    app.setApplicationDisplayName("ITAssetFlow")
    app.setOrganizationName("DLC-Informatik GmbH")
    app.setOrganizationDomain("dlc-informatik.ch")

    return app


def show_startup_error(
    title: str,
    message: str,
) -> None:
    """
    Zeigt einen Fehler an, bevor das Hauptfenster geöffnet wurde.
    """

    QMessageBox.critical(
        None,
        title,
        message,
    )


def initialize_supabase() -> tuple[Client, str]:
    """
    Erstellt den gemeinsamen Supabase-Client und meldet den
    temporären Entwicklungsbenutzer an.

    Rückgabewerte:
        - angemeldeter Supabase-Client
        - E-Mail-Adresse des angemeldeten Benutzers
    """

    logger.info("Initializing Supabase client.")

    client = get_supabase_client()

    authenticated_email = login_development_user(
        client
    )

    logger.info(
        "Authenticated Supabase user: %s",
        authenticated_email,
    )

    if not test_authenticated_access(client):
        raise RuntimeError(
            "Der Benutzer wurde erfolgreich angemeldet, besitzt aber "
            "keinen Zugriff auf die Tabelle „assets“.\n\n"
            "Prüfe in Supabase:\n"
            "• GRANT SELECT für authenticated\n"
            "• aktivierte Row Level Security\n"
            "• eine SELECT-Policy für authenticated"
        )

    return client, authenticated_email


def run() -> int:
    """
    Startet AssetFlow IT.

    Rückgabewert:
        Exit-Code der Anwendung.
    """

    setup_logging()

    logger.info("Starting ITAssetFlow")

    app = create_application()

    supabase_client: Client | None = None

    try:
        supabase_client, authenticated_email = (
            initialize_supabase()
        )

    except Exception as error:
        logger.exception(
            "Application startup failed during Supabase initialization."
        )

        show_startup_error(
            "AssetFlow IT – Startfehler",
            (
                "AssetFlow IT konnte nicht gestartet werden.\n\n"
                f"{error}\n\n"
                "Prüfe zusätzlich die Supabase-Zugangsdaten "
                "in deiner .env-Datei."
            ),
        )

        return 1

    try:
        window = MainWindow(
            supabase_client=supabase_client,
            authenticated_email=authenticated_email,
        )

        window.show()

        logger.info("Main window opened.")

        exit_code = app.exec()

        logger.info(
            "Qt application stopped with exit code %s.",
            exit_code,
        )

        return exit_code

    except Exception as error:
        logger.exception(
            "Unexpected error while running AssetFlow IT."
        )

        show_startup_error(
            "AssetFlow IT – Programmfehler",
            (
                "Während der Ausführung ist ein Fehler aufgetreten.\n\n"
                f"{error}"
            ),
        )

        return 1

    finally:
        if supabase_client is not None:
            logout_user(supabase_client)

        logger.info("AssetFlow IT stopped.")


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()