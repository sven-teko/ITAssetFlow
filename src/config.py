from __future__ import annotations

import codecs
import os
import re
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Mapping

from dotenv import dotenv_values


@dataclass(frozen=True)
class AppConfig:
    """Zentrale Laufzeitkonfiguration der Anwendung."""

    supabase_url: str
    supabase_key: str
    env_file: Path | None

    # Übergangskompatibilität:
    # Alte Module können diese Attribute weiterhin lesen. Der neue
    # Programmstart verwendet sie jedoch bewusst nicht mehr.
    development_email: str = ""
    development_password: str = ""


@dataclass(frozen=True)
class SupabaseConnectionSettings:
    """Im Loginfenster editierbare Supabase-Verbindung."""

    supabase_url: str
    supabase_key: str
    env_file: Path


def _candidate_env_files() -> list[Path]:
    """Liefert die bewusst unterstützten Speicherorte für ``.env``."""

    candidates: list[Path] = []

    if getattr(sys, "frozen", False):
        candidates.append(
            Path(sys.executable).resolve().parent / ".env"
        )

    # config.py liegt unter <Projekt>/src/config.py.
    project_root = Path(__file__).resolve().parent.parent
    candidates.append(project_root / ".env")
    candidates.append(Path.cwd() / ".env")

    unique: list[Path] = []
    for path in candidates:
        if path not in unique:
            unique.append(path)

    return unique


def _find_env_file() -> Path | None:
    for path in _candidate_env_files():
        if path.is_file():
            return path
    return None


def _default_env_file() -> Path:
    """Zieldatei, falls beim ersten Start noch keine ``.env`` existiert."""

    candidates = _candidate_env_files()
    if not candidates:
        raise RuntimeError(
            "Es konnte kein Speicherort für die .env-Datei bestimmt werden."
        )
    return candidates[0]


def _detect_env_encoding(path: Path) -> str:
    """Erkennt gängige Windows-Kodierungen anhand des Byte-Order-Marks."""

    try:
        prefix = path.read_bytes()[:4]
    except OSError as error:
        raise RuntimeError(
            "Die .env-Datei konnte nicht gelesen werden.\n\n"
            f"Datei:\n{path}\n\n"
            f"Technischer Fehler: {error}"
        ) from error

    if prefix.startswith(codecs.BOM_UTF8):
        return "utf-8-sig"

    if (
        prefix.startswith(codecs.BOM_UTF32_LE)
        or prefix.startswith(codecs.BOM_UTF32_BE)
    ):
        return "utf-32"

    if (
        prefix.startswith(codecs.BOM_UTF16_LE)
        or prefix.startswith(codecs.BOM_UTF16_BE)
    ):
        return "utf-16"

    return "utf-8"


def _read_env_values(
    env_file: Path | None,
) -> Mapping[str, object]:
    """Liest die ``.env`` mit automatisch erkannter Textkodierung."""

    if env_file is None:
        return {}

    encoding = _detect_env_encoding(env_file)

    try:
        return dotenv_values(
            env_file,
            encoding=encoding,
        )
    except UnicodeError as error:
        raise RuntimeError(
            "Die .env-Datei besitzt eine nicht unterstützte "
            "Textkodierung.\n\n"
            f"Datei:\n{env_file}\n\n"
            "Speichere die Datei wenn möglich als UTF-8.\n\n"
            f"Technischer Fehler: {error}"
        ) from error
    except OSError as error:
        raise RuntimeError(
            "Die .env-Datei konnte nicht gelesen werden.\n\n"
            f"Datei:\n{env_file}\n\n"
            f"Technischer Fehler: {error}"
        ) from error


def _file_value(
    name: str,
    file_values: Mapping[str, object],
) -> str:
    value = file_values.get(name)
    if value is None:
        return ""
    return str(value).strip()


def _environment_value(
    name: str,
    file_values: Mapping[str, object],
) -> str:
    """Für alte Aufrufer bleiben OS-Variablen mit höchster Priorität."""

    system_value = os.getenv(name)
    if system_value and system_value.strip():
        return system_value.strip()

    return _file_value(name, file_values)


def _connection_values_from_file(
    file_values: Mapping[str, object],
) -> tuple[str, str]:
    """Login-Dialog: bewusst zuerst die editierbare ``.env`` verwenden."""

    url = _file_value("SUPABASE_URL", file_values)
    key = (
        _file_value("SUPABASE_PUBLISHABLE_KEY", file_values)
        or _file_value("SUPABASE_ANON_KEY", file_values)
        or _file_value("SUPABASE_KEY", file_values)
    )

    # Falls noch keine .env-Werte vorhanden sind, dürfen klassische
    # Betriebssystemvariablen als Startwert dienen.
    if not url:
        url = str(os.getenv("SUPABASE_URL") or "").strip()

    if not key:
        key = str(
            os.getenv("SUPABASE_PUBLISHABLE_KEY")
            or os.getenv("SUPABASE_ANON_KEY")
            or os.getenv("SUPABASE_KEY")
            or ""
        ).strip()

    return url, key


def _configuration_source_text(env_file: Path | None) -> str:
    if env_file is not None:
        return (
            f"Geladene Datei:\n{env_file}\n"
            f"Erkannte Kodierung: {_detect_env_encoding(env_file)}"
        )

    checked = "\n".join(
        f"- {path}"
        for path in _candidate_env_files()
    )
    return (
        "Es wurde keine .env-Datei gefunden.\n\n"
        f"Geprüfte Speicherorte:\n{checked}"
    )


def load_supabase_connection_settings() -> SupabaseConnectionSettings:
    """Lädt URL und Publishable Key für das Loginfenster.

    Anders als ``get_app_config`` wirft diese Funktion bei fehlenden Werten
    keinen Fehler. Dadurch kann das Loginfenster auch beim allerersten Start
    geöffnet und dort die Verbindung konfiguriert werden.
    """

    env_file = _find_env_file() or _default_env_file()
    file_values = (
        _read_env_values(env_file)
        if env_file.is_file()
        else {}
    )
    url, key = _connection_values_from_file(file_values)

    return SupabaseConnectionSettings(
        supabase_url=url,
        supabase_key=key,
        env_file=env_file,
    )


def save_supabase_connection_settings(
    supabase_url: str,
    supabase_key: str,
) -> Path:
    """Speichert URL und Publishable Key in der lokalen ``.env``.

    Andere Einträge und Kommentare bleiben erhalten. Login-E-Mail und
    Passwort werden bewusst nicht gespeichert.
    """

    url = str(supabase_url or "").strip()
    key = str(supabase_key or "").strip()

    if not url:
        raise ValueError("Supabase URL fehlt.")

    if not re.match(r"^https?://", url, flags=re.IGNORECASE):
        raise ValueError(
            "Die Supabase URL muss mit http:// oder https:// beginnen."
        )

    if not key:
        raise ValueError("Supabase Publishable Key fehlt.")

    env_file = _find_env_file() or _default_env_file()
    env_file.parent.mkdir(parents=True, exist_ok=True)

    if env_file.is_file():
        encoding = _detect_env_encoding(env_file)
        try:
            content = env_file.read_text(encoding=encoding)
        except (OSError, UnicodeError) as error:
            raise RuntimeError(
                "Die .env-Datei konnte nicht zum Bearbeiten geöffnet werden."
                f"\n\nDatei:\n{env_file}\n\nTechnischer Fehler: {error}"
            ) from error
    else:
        content = ""

    lines = content.splitlines()
    replacements = {
        "SUPABASE_URL": f"SUPABASE_URL={url}",
        "SUPABASE_PUBLISHABLE_KEY": (
            f"SUPABASE_PUBLISHABLE_KEY={key}"
        ),
    }
    found: set[str] = set()
    output: list[str] = []

    assignment_pattern = re.compile(
        r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*="
    )

    for line in lines:
        match = assignment_pattern.match(line)
        name = match.group(1) if match else None

        if name in replacements:
            if name not in found:
                output.append(replacements[name])
                found.add(name)
            # Doppelte Definitionen desselben Keys werden entfernt.
            continue

        output.append(line)

    for name in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"):
        if name not in found:
            if output and output[-1].strip():
                output.append("")
            output.append(replacements[name])

    try:
        env_file.write_text(
            "\n".join(output).rstrip() + "\n",
            encoding="utf-8",
        )
    except OSError as error:
        raise RuntimeError(
            "Die Supabase-Verbindung konnte nicht in .env gespeichert werden."
            f"\n\nDatei:\n{env_file}\n\nTechnischer Fehler: {error}"
        ) from error

    # Falls ältere Programmteile get_app_config() verwenden, müssen sie nach
    # einer Änderung die neue Datei lesen.
    get_app_config.cache_clear()

    return env_file


@lru_cache(maxsize=1)
def get_app_config() -> AppConfig:
    """Kompatible, validierte Konfiguration für bestehende Module."""

    env_file = _find_env_file()
    file_values = _read_env_values(env_file)

    supabase_url = _environment_value(
        "SUPABASE_URL",
        file_values,
    )
    supabase_key = (
        _environment_value(
            "SUPABASE_PUBLISHABLE_KEY",
            file_values,
        )
        or _environment_value(
            "SUPABASE_ANON_KEY",
            file_values,
        )
        or _environment_value(
            "SUPABASE_KEY",
            file_values,
        )
    )

    if not supabase_url:
        raise RuntimeError(
            "SUPABASE_URL fehlt.\n\n"
            f"{_configuration_source_text(env_file)}"
        )

    if not supabase_key:
        raise RuntimeError(
            "Der öffentliche Supabase-Schlüssel fehlt.\n\n"
            "Verwende SUPABASE_PUBLISHABLE_KEY.\n\n"
            f"{_configuration_source_text(env_file)}"
        )

    return AppConfig(
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        env_file=env_file,
        development_email=_environment_value(
            "SUPABASE_DEV_EMAIL",
            file_values,
        ),
        development_password=_environment_value(
            "SUPABASE_DEV_PASSWORD",
            file_values,
        ),
    )
