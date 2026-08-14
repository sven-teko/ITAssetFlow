from __future__ import annotations

import os
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
    development_email: str
    development_password: str
    env_file: Path | None


def _candidate_env_files() -> list[Path]:
    """Liefert die wenigen bewusst unterstützten Speicherorte für ``.env``."""

    candidates: list[Path] = []

    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).resolve().parent / ".env")

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


def _environment_value(
    name: str,
    file_values: Mapping[str, object],
) -> str:
    """OS-Umgebungsvariablen haben Vorrang vor Werten aus ``.env``."""

    system_value = os.getenv(name)
    if system_value and system_value.strip():
        return system_value.strip()

    file_value = file_values.get(name)
    if file_value is None:
        return ""
    return str(file_value).strip()


def _configuration_source_text(env_file: Path | None) -> str:
    if env_file is not None:
        return f"Geladene Datei:\n{env_file}"

    checked = "\n".join(
        f"- {path}"
        for path in _candidate_env_files()
    )
    return (
        "Es wurde keine .env-Datei gefunden. "
        "Alternativ können Betriebssystem-Umgebungsvariablen verwendet werden.\n\n"
        f"Geprüfte Speicherorte:\n{checked}"
    )


@lru_cache(maxsize=1)
def get_app_config() -> AppConfig:
    """Lädt und validiert die Konfiguration erst bei tatsächlicher Verwendung.

    Dadurch kann ``main.py`` die Qt-Anwendung bereits starten und einen
    verständlichen Dialog anzeigen, falls die Konfiguration fehlerhaft ist.
    """

    env_file = _find_env_file()
    file_values = dotenv_values(env_file) if env_file is not None else {}

    supabase_url = _environment_value("SUPABASE_URL", file_values)
    supabase_key = (
        _environment_value("SUPABASE_PUBLISHABLE_KEY", file_values)
        or _environment_value("SUPABASE_ANON_KEY", file_values)
        or _environment_value("SUPABASE_KEY", file_values)
    )

    if not supabase_url:
        raise RuntimeError(
            "SUPABASE_URL fehlt.\n\n"
            f"{_configuration_source_text(env_file)}"
        )

    if not supabase_key:
        raise RuntimeError(
            "Der öffentliche Supabase-Schlüssel fehlt.\n\n"
            "Verwende SUPABASE_PUBLISHABLE_KEY (bevorzugt) oder "
            "SUPABASE_ANON_KEY.\n\n"
            f"{_configuration_source_text(env_file)}"
        )

    return AppConfig(
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        development_email=_environment_value(
            "SUPABASE_DEV_EMAIL",
            file_values,
        ),
        development_password=_environment_value(
            "SUPABASE_DEV_PASSWORD",
            file_values,
        ),
        env_file=env_file,
    )
