from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from supabase import Client, create_client


logger = logging.getLogger(__name__)


def find_env_file() -> Path:
    """
    Sucht die .env-Datei im aktuellen Arbeitsverzeichnis und
    in allen übergeordneten Verzeichnissen dieser Python-Datei.
    """

    current_file = Path(__file__).resolve()

    search_directories: list[Path] = [
        Path.cwd(),
        current_file.parent,
        *current_file.parents,
    ]

    checked_paths: list[Path] = []
    unique_directories: list[Path] = []

    for directory in search_directories:
        if directory not in unique_directories:
            unique_directories.append(directory)

    for directory in unique_directories:
        env_path = directory / ".env"
        checked_paths.append(env_path)

        if env_path.is_file():
            logger.info(
                "Using environment file: %s",
                env_path,
            )
            return env_path

    # Häufiger Windows-Fehler: Dateiendung wird ausgeblendet.
    for directory in unique_directories:
        env_txt_path = directory / ".env.txt"

        if env_txt_path.is_file():
            raise RuntimeError(
                "Es wurde eine Datei namens '.env.txt' gefunden:\n"
                f"{env_txt_path}\n\n"
                "Benenne sie in '.env' um."
            )

    checked_text = "\n".join(
        f"- {path}"
        for path in checked_paths
    )

    raise RuntimeError(
        "Die .env-Datei wurde nicht gefunden.\n\n"
        "Geprüfte Speicherorte:\n"
        f"{checked_text}\n\n"
        "Lege die Datei am besten direkt neben main.py ab."
    )


ENV_FILE = find_env_file()

# Lädt die Werte zusätzlich in os.environ.
load_dotenv(
    dotenv_path=ENV_FILE,
    override=False,
)

# Liest die Datei direkt ein. Dadurch funktionieren die Werte auch,
# falls load_dotenv aufgrund einer bereits vorhandenen leeren
# Umgebungsvariable nichts überschreibt.
ENV_VALUES = dotenv_values(ENV_FILE)


def get_environment_value(
    variable_name: str,
) -> str:
    """
    Liest zuerst eine Betriebssystem-Umgebungsvariable und danach
    den Wert direkt aus der .env-Datei.
    """

    system_value = os.getenv(variable_name)

    if system_value and system_value.strip():
        return system_value.strip()

    file_value = ENV_VALUES.get(variable_name)

    if file_value:
        return str(file_value).strip()

    return ""


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """
    Erstellt genau eine gemeinsame Supabase-Client-Instanz.

    Authentifizierung und Tabellenabfragen müssen immer dieselbe
    Client-Instanz verwenden.
    """

    supabase_url = get_environment_value(
        "SUPABASE_URL"
    )

    supabase_key = (
        get_environment_value(
            "SUPABASE_PUBLISHABLE_KEY"
        )
        or get_environment_value(
            "SUPABASE_ANON_KEY"
        )
        or get_environment_value(
            "SUPABASE_KEY"
        )
    )

    if not supabase_url:
        raise RuntimeError(
            "SUPABASE_URL fehlt in der .env-Datei.\n\n"
            f"Geladene Datei:\n{ENV_FILE}"
        )

    if not supabase_key:
        raise RuntimeError(
            "Der öffentliche Supabase-Schlüssel fehlt.\n\n"
            "Verwende eine der folgenden Variablen:\n"
            "- SUPABASE_PUBLISHABLE_KEY\n"
            "- SUPABASE_ANON_KEY\n"
            "- SUPABASE_KEY\n\n"
            f"Geladene Datei:\n{ENV_FILE}"
        )

    logger.info(
        "Creating shared Supabase client for %s.",
        supabase_url,
    )

    return create_client(
        supabase_url,
        supabase_key,
    )


def login_development_user(
    client: Client,
) -> str:
    """
    Meldet den temporären Entwicklungsbenutzer über Supabase Auth an.

    Diese Funktion wird später durch das Login-Popup ersetzt.
    """

    email = get_environment_value(
        "SUPABASE_DEV_EMAIL"
    )

    password = get_environment_value(
        "SUPABASE_DEV_PASSWORD"
    )

    if not email:
        raise RuntimeError(
            "SUPABASE_DEV_EMAIL fehlt in der .env-Datei."
        )

    if not password:
        raise RuntimeError(
            "SUPABASE_DEV_PASSWORD fehlt in der .env-Datei."
        )

    logger.info(
        "Signing in development user: %s",
        email,
    )

    try:
        response = client.auth.sign_in_with_password(
            {
                "email": email,
                "password": password,
            }
        )

    except Exception as error:
        logger.exception(
            "Supabase authentication failed."
        )

        raise RuntimeError(
            "Die Anmeldung bei Supabase ist fehlgeschlagen.\n\n"
            "Prüfe E-Mail-Adresse, Passwort und den Benutzer "
            "unter Supabase → Authentication → Users.\n\n"
            f"Technischer Fehler: {error}"
        ) from error

    if response.user is None:
        raise RuntimeError(
            "Supabase hat keinen Benutzer zurückgegeben."
        )

    if response.session is None:
        raise RuntimeError(
            "Supabase hat keine gültige Sitzung erstellt."
        )

    authenticated_email = response.user.email or email

    logger.info(
        "Supabase authentication successful: %s",
        authenticated_email,
    )

    return authenticated_email


def test_authenticated_access(
    client: Client,
) -> bool:
    """
    Prüft, ob die authentifizierte Sitzung auf public.assets
    zugreifen darf.
    """

    try:
        response = (
            client
            .table("assets")
            .select("id")
            .limit(1)
            .execute()
        )

        logger.info(
            "Authenticated assets access successful. Rows returned: %s",
            len(response.data or []),
        )

        return True

    except Exception:
        logger.exception(
            "Authenticated access to assets failed."
        )
        return False


def logout_user(
    client: Client,
) -> None:
    """
    Meldet die aktuelle Supabase-Sitzung ab.
    """

    try:
        client.auth.sign_out()
        logger.info(
            "Supabase user signed out."
        )

    except Exception:
        logger.exception(
            "Supabase logout failed."
        )