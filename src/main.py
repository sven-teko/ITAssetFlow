from __future__ import annotations

import codecs
from importlib import metadata
import logging
from pathlib import Path
import subprocess
import sys


APP_NAME = "ITAssetFlow"
ORGANIZATION_NAME = "DLC-Informatik GmbH"
ORGANIZATION_DOMAIN = "dlc-informatik.ch"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REQUIREMENTS_FILE = PROJECT_ROOT / "requirements.txt"


def _read_text_auto(path: Path) -> str:
    """Liest UTF-8-, UTF-16- und UTF-32-Textdateien robust ein."""

    prefix = path.read_bytes()[:4]

    if prefix.startswith(codecs.BOM_UTF8):
        encoding = "utf-8-sig"
    elif (
        prefix.startswith(codecs.BOM_UTF32_LE)
        or prefix.startswith(codecs.BOM_UTF32_BE)
    ):
        encoding = "utf-32"
    elif (
        prefix.startswith(codecs.BOM_UTF16_LE)
        or prefix.startswith(codecs.BOM_UTF16_BE)
    ):
        encoding = "utf-16"
    else:
        encoding = "utf-8"

    return path.read_text(encoding=encoding)


def _required_packages() -> list[str]:
    """Liest nur die Paketnamen aus requirements.txt."""

    if not REQUIREMENTS_FILE.is_file():
        raise RuntimeError(
            f"requirements.txt wurde nicht gefunden: {REQUIREMENTS_FILE}"
        )

    packages: list[str] = []

    for raw_line in _read_text_auto(REQUIREMENTS_FILE).splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#"):
            continue

        line = line.split("#", 1)[0].strip()

        # Paketname vor Versionsoperatoren extrahieren.
        for separator in ("==", ">=", "<=", "~=", "!=", ">", "<"):
            if separator in line:
                line = line.split(separator, 1)[0].strip()
                break

        if line:
            packages.append(line)

    return packages


def _missing_packages() -> list[str]:
    """Prüft nur, ob ein Paket installiert ist – nicht dessen Version."""

    missing: list[str] = []

    for package_name in _required_packages():
        try:
            metadata.version(package_name)
        except metadata.PackageNotFoundError:
            missing.append(package_name)

    return missing


def ensure_runtime_dependencies() -> None:
    """Installiert fehlende Requirements still vor dem eigentlichen Start."""

    if getattr(sys, "frozen", False):
        return

    missing = _missing_packages()
    if not missing:
        return

    # Falls pip in der Python-Installation noch nicht eingerichtet ist.
    pip_check = subprocess.run(
        [sys.executable, "-m", "pip", "--version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )

    if pip_check.returncode != 0:
        subprocess.run(
            [sys.executable, "-m", "ensurepip", "--upgrade"],
            check=True,
        )

    # Keine GUI-Meldung: fehlende Pakete werden einfach installiert.
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            str(REQUIREMENTS_FILE),
        ],
        check=True,
    )


# Muss vor PySide6, Supabase usw. ausgeführt werden.
ensure_runtime_dependencies()


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
