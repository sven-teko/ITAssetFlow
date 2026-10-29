"""Kompatibilität mit Datenbanken ohne die optionalen Scanner-Spalten.

Nur nachgewiesene fehlende QR-/EAN-Spalten werden berücksichtigt. Andere
Datenbankfehler bleiben sichtbar; ausgefüllte Kennungen werden nie verworfen.
"""
import re
from typing import Any, Callable


SCANNER_SETUP_MESSAGE = (
    "Die QR-/EAN-Erweiterung fehlt in der verwendeten Datenbank. "
    "Bitte database/scanner_codes.sql im SQL-Editor genau dieser Datenbank "
    "ausführen. Ohne neue Scanner-Kennungen können normale Einträge "
    "weiterhin bearbeitet werden."
)


def missing_scanner_column(error: Exception, table: str) -> str | None:
    if table not in {"assets", "product_models"}:
        return None
    code = str(getattr(error, "code", ""))
    message = str(getattr(error, "message", "") or error)
    if code not in {"42703", "PGRST204"}:
        return None
    if code == "42703":
        match = re.search(
            rf'column\s+(?:"?public"?\.)?"?{table}"?\."?(qr_code|ean)"?\s+does not exist',
            message, re.IGNORECASE,
        )
        return match[1].lower() if match else None
    match = re.search(
        rf"Could not find the ['\"](qr_code|ean)['\"] column of ['\"]{table}['\"]",
        message, re.IGNORECASE,
    )
    return match[1].lower() if match else None


def select_scanner_compatible(
    query: Callable[[str], Any], table: str, columns: str,
) -> Any:
    selected = columns.split(",")
    while True:
        try:
            return query(",".join(selected)).execute()
        except Exception as error:
            missing = missing_scanner_column(error, table)
            if missing is None or missing not in selected:
                raise
            selected.remove(missing)


def write_scanner_compatible(
    query: Callable[[dict[str, Any]], Any], table: str, values: dict[str, Any],
) -> Any:
    payload = dict(values)
    while True:
        try:
            return query(payload).execute()
        except Exception as error:
            missing = missing_scanner_column(error, table)
            if missing is None or missing not in payload:
                raise
            if payload[missing] is not None:
                raise ValueError(SCANNER_SETUP_MESSAGE) from error
            # Ein Fehler beim Auflösen einer Spalte findet vor dem Schreiben
            # statt. Ausschliesslich leere, nicht vorhandene Felder weglassen.
            del payload[missing]
