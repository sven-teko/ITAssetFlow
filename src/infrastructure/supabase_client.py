from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from httpx import TimeoutException, TransportError
from supabase import Client, create_client

from config import get_app_config


logger = logging.getLogger(__name__)


def create_supabase_client(
    supabase_url: str,
    supabase_key: str,
) -> Client:
    """Erstellt einen neuen Supabase-Client für die angegebenen Werte."""

    url = str(supabase_url or "").strip().rstrip("/")
    key = str(supabase_key or "").strip()

    if not url:
        raise RuntimeError("Supabase URL fehlt.")

    if not key:
        raise RuntimeError("Supabase Publishable Key fehlt.")

    logger.info("Creating Supabase client for %s.", url)

    try:
        return create_client(url, key)
    except Exception as error:
        logger.exception("Creating Supabase client failed.")
        raise RuntimeError(
            "Die Supabase-Verbindung konnte nicht initialisiert werden.\n\n"
            "Prüfe URL und Publishable Key.\n\n"
            f"Technischer Fehler: {error}"
        ) from error


def get_supabase_client() -> Client:
    """Kompatibilitätsfunktion für ältere Programmteile."""

    config = get_app_config()
    return create_supabase_client(
        config.supabase_url,
        config.supabase_key,
    )


def test_supabase_connection(
    supabase_url: str,
    supabase_key: str,
) -> str:
    """Prüft URL und Publishable Key über den offiziellen Auth-Health-Endpunkt."""

    url = str(supabase_url or "").strip().rstrip("/")
    key = str(supabase_key or "").strip()

    if not url:
        raise RuntimeError("Supabase URL fehlt.")
    if not key:
        raise RuntimeError("Supabase Publishable Key fehlt.")

    health_url = f"{url}/auth/v1/health"

    try:
        response = httpx.get(
            health_url,
            headers={
                "apikey": key,
            },
            timeout=10.0,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        raise RuntimeError(
            "Die Supabase-Verbindung antwortet, aber URL oder "
            f"Publishable Key wurden abgelehnt (HTTP {status})."
        ) from error
    except (httpx.TimeoutException, httpx.TransportError) as error:
        raise RuntimeError(
            "Supabase konnte nicht erreicht werden.\n\n"
            "Prüfe Internetverbindung und Supabase URL.\n\n"
            f"Technischer Fehler: {error}"
        ) from error

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    version = ""
    if isinstance(payload, dict):
        version = str(
            payload.get("version")
            or ""
        ).strip()

    return (
        f"Verbindung erfolgreich"
        + (f" · Auth {version}" if version else "")
    )


def login_user(
    client: Client,
    email: str,
    password: str,
) -> str:
    """Meldet einen Benutzer über Supabase Auth an."""

    normalized_email = str(email or "").strip()
    normalized_password = str(password or "")

    if not normalized_email:
        raise RuntimeError("E-Mail-Adresse fehlt.")

    if not normalized_password:
        raise RuntimeError("Passwort fehlt.")

    logger.info(
        "Signing in Supabase user: %s",
        normalized_email,
    )

    response = None
    last_error: Exception | None = None

    for attempt in range(1, 4):
        try:
            response = client.auth.sign_in_with_password(
                {
                    "email": normalized_email,
                    "password": normalized_password,
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
                "Prüfe E-Mail-Adresse und Passwort.\n\n"
                f"Technischer Fehler: {error}"
            ) from error

    if response is None:
        raise RuntimeError(
            "Supabase konnte nach mehreren Versuchen nicht erreicht werden.\n\n"
            "Prüfe Netzwerkverbindung, Supabase URL und Publishable Key.\n\n"
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

    authenticated_email = (
        response.user.email
        or normalized_email
    )

    logger.info(
        "Supabase authentication successful: %s",
        authenticated_email,
    )

    return authenticated_email


def restore_user_session(
    supabase_url: str,
    supabase_key: str,
    access_token: str,
    refresh_token: str,
) -> tuple[Client, str]:
    """Stellt eine gespeicherte Supabase-Sitzung wieder her.

    ``set_session`` aktualisiert eine abgelaufene Sitzung bei gültigem
    Refresh-Token automatisch.
    """

    client = create_supabase_client(
        supabase_url,
        supabase_key,
    )

    try:
        response = client.auth.set_session(
            access_token,
            refresh_token,
        )
    except Exception as error:
        logger.exception(
            "Restoring Supabase session failed."
        )
        raise RuntimeError(
            "Der gespeicherte Login ist nicht mehr gültig.\n\n"
            "Bitte melde dich erneut mit deinem Passwort an."
        ) from error

    user = getattr(response, "user", None)
    session = getattr(response, "session", None)

    if session is None:
        session = _current_session(client)

    if user is None:
        try:
            user_response = client.auth.get_user()
            user = getattr(
                user_response,
                "user",
                None,
            )
        except Exception:
            logger.exception(
                "Retrieving restored Supabase user failed."
            )

    email = str(
        getattr(user, "email", "")
        or ""
    ).strip()

    if not email:
        raise RuntimeError(
            "Der gespeicherte Login konnte keinem Benutzer zugeordnet werden."
        )

    if not test_authenticated_access(client):
        raise RuntimeError(
            "Der gespeicherte Login ist gültig, besitzt aber keinen "
            "Lesenzugriff auf die Inventardaten."
        )

    return client, email


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
            logger.exception(
                "Authenticated access to assets failed."
            )
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


def authenticate_user(
    supabase_url: str,
    supabase_key: str,
    email: str,
    password: str,
) -> tuple[Client, str]:
    """Erstellt Client + Sitzung und prüft anschließend den Datenzugriff."""

    client = create_supabase_client(
        supabase_url,
        supabase_key,
    )

    authenticated_email = login_user(
        client,
        email,
        password,
    )

    if not test_authenticated_access(client):
        try:
            client.auth.sign_out(
                {"scope": "local"}
            )
        except Exception:
            logger.exception(
                "Local logout after failed access test failed."
            )

        raise RuntimeError(
            "Die Anmeldung war erfolgreich, aber der Benutzer besitzt "
            "keinen Lesenzugriff auf die Inventardaten.\n\n"
            "Prüfe in Supabase die RLS-Policies und Berechtigungen "
            "für die Rolle authenticated."
        )

    return client, authenticated_email


def _current_session(client: Client) -> Any | None:
    try:
        value = client.auth.get_session()
    except Exception:
        logger.exception(
            "Reading current Supabase session failed."
        )
        return None

    nested = getattr(value, "session", None)
    return nested if nested is not None else value


def get_session_tokens(
    client: Client,
) -> tuple[str, str] | None:
    """Liest aktuelle Access-/Refresh-Tokens für den lokalen Session Store."""

    session = _current_session(client)
    if session is None:
        return None

    access_token = str(
        getattr(session, "access_token", "")
        or ""
    ).strip()
    refresh_token = str(
        getattr(session, "refresh_token", "")
        or ""
    ).strip()

    if not access_token or not refresh_token:
        return None

    return access_token, refresh_token


def logout_user(
    client: Client,
    *,
    global_logout: bool = False,
) -> None:
    """Meldet eine Sitzung explizit ab.

    Der normale Programmexit ruft diese Funktion nicht auf, damit ein
    gespeicherter Login beim nächsten Start weiterverwendet werden kann.
    """

    try:
        if global_logout:
            client.auth.sign_out()
        else:
            client.auth.sign_out(
                {"scope": "local"}
            )
    except Exception:
        logger.exception("Supabase logout failed.")
        return

    logger.info("Supabase user signed out.")
