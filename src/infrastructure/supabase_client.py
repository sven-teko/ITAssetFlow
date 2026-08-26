from __future__ import annotations

import logging
import time
from functools import lru_cache

from httpx import TimeoutException, TransportError

from supabase import Client, create_client

from config import get_app_config


logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """Erstellt genau eine gemeinsame Supabase-Client-Instanz."""

    config = get_app_config()

    logger.info(
        "Creating shared Supabase client for %s.",
        config.supabase_url,
    )
    if config.env_file is not None:
        logger.info("Using environment file: %s", config.env_file)

    return create_client(
        config.supabase_url,
        config.supabase_key,
    )


def login_development_user(client: Client) -> str:
    """Meldet den temporären Entwicklungsbenutzer über Supabase Auth an.

    Diese Funktion bleibt bewusst getrennt vom Client-Aufbau und kann später
    durch das eigentliche Login-Fenster ersetzt werden.
    """

    config = get_app_config()
    email = config.development_email
    password = config.development_password

    if not email:
        raise RuntimeError(
            "SUPABASE_DEV_EMAIL fehlt für die Entwicklungsanmeldung."
        )

    if not password:
        raise RuntimeError(
            "SUPABASE_DEV_PASSWORD fehlt für die Entwicklungsanmeldung."
        )

    logger.info("Signing in development user: %s", email)

    response = None
    last_error: Exception | None = None

    # Auf neuen Rechnern kann der erste TLS-/HTTP-Aufbau vereinzelt
    # in einen ReadTimeout laufen. Nur echte Netzwerk-/Timeoutfehler
    # werden automatisch wiederholt; falsche Zugangsdaten nicht.
    for attempt in range(1, 4):
        try:
            response = client.auth.sign_in_with_password(
                {
                    "email": email,
                    "password": password,
                }
            )
            break
        except (TimeoutException, TransportError) as error:
            last_error = error
            logger.warning(
                "Supabase authentication network error on attempt %s/3: %s",
                attempt,
                error,
            )
            if attempt < 3:
                time.sleep(attempt)
        except Exception as error:
            logger.exception("Supabase authentication failed.")
            raise RuntimeError(
                "Die Anmeldung bei Supabase ist fehlgeschlagen.\n\n"
                "Prüfe E-Mail-Adresse, Passwort und den Benutzer unter "
                "Supabase → Authentication → Users.\n\n"
                f"Technischer Fehler: {error}"
            ) from error

    if response is None:
        logger.exception(
            "Supabase authentication failed after retries.",
            exc_info=last_error,
        )
        raise RuntimeError(
            "Supabase konnte nach mehreren Versuchen nicht erreicht werden.\n\n"
            "Die Zugangsdaten sind grundsätzlich gültig, aber die "
            "Netzwerkverbindung hat während der Anmeldung nicht rechtzeitig "
            "geantwortet.\n\n"
            f"Technischer Fehler: {last_error}"
        ) from last_error

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


def test_authenticated_access(client: Client) -> bool:
    """Prüft, ob die aktuelle Sitzung ``public.assets`` lesen darf."""

    response = None

    for attempt in range(1, 4):
        try:
            response = (
                client
                .table("assets")
                .select("id")
                .limit(1)
                .execute()
            )
            break
        except (TimeoutException, TransportError) as error:
            logger.warning(
                "Authenticated assets access network error on attempt %s/3: %s",
                attempt,
                error,
            )
            if attempt < 3:
                time.sleep(attempt)
        except Exception:
            logger.exception("Authenticated access to assets failed.")
            return False

    if response is None:
        logger.error(
            "Authenticated access to assets failed after retries."
        )
        return False

    logger.info(
        "Authenticated assets access successful. Rows returned: %s",
        len(response.data or []),
    )
    return True


def logout_user(client: Client) -> None:
    """Meldet die aktuelle Supabase-Sitzung beim Programmende ab."""

    try:
        client.auth.sign_out()
    except Exception:
        logger.exception("Supabase logout failed.")
        return

    logger.info("Supabase user signed out.")
