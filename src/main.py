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
from ui.theme import apply_light_theme


logger = logging.getLogger(__name__)

APP_NAME = "ITAssetFlow"
ORGANIZATION_NAME = "DLC-Informatik GmbH"
ORGANIZATION_DOMAIN = "dlc-informatik.ch"


def create_application() -> QApplication:
    """Erstellt und konfiguriert die Qt-Anwendung."""

    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationDisplayName(APP_NAME)
    app.setOrganizationName(ORGANIZATION_NAME)
    app.setOrganizationDomain(ORGANIZATION_DOMAIN)

    # Das Theme wird vor Supabase initialisiert, damit auch Startfehler-Dialoge
    # unabhängig vom Windows-Hell/Dunkel-Modus lesbar bleiben.
    apply_light_theme(app)
    return app


def show_startup_error(title: str, message: str) -> None:
    """Zeigt einen Fehler an, bevor das Hauptfenster geöffnet wurde."""

    QMessageBox.critical(None, title, message)


def initialize_supabase() -> tuple[Client, str]:
    """Erstellt den gemeinsamen Client und meldet den Entwicklungsbenutzer an."""

    logger.info("Initializing Supabase client.")
    client = get_supabase_client()
    authenticated_email = login_development_user(client)

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
    """Startet ITAssetFlow und gibt den Prozess-Exit-Code zurück."""

    setup_logging()
    logger.info("Starting ITAssetFlow")

    app = create_application()
    supabase_client: Client | None = None

    try:
        supabase_client, authenticated_email = initialize_supabase()
    except Exception as error:
        logger.exception(
            "Application startup failed during Supabase initialization."
        )
        show_startup_error(
            "ITAssetFlow – Startfehler",
            (
                "ITAssetFlow konnte nicht gestartet werden.\n\n"
                f"{error}\n\n"
                "Prüfe zusätzlich die Supabase-Konfiguration."
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
        logger.exception("Unexpected error while running ITAssetFlow.")
        show_startup_error(
            "ITAssetFlow – Programmfehler",
            (
                "Während der Ausführung ist ein Fehler aufgetreten.\n\n"
                f"{error}"
            ),
        )
        return 1

    finally:
        if supabase_client is not None:
            logout_user(supabase_client)

        logger.info("ITAssetFlow stopped.")


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
