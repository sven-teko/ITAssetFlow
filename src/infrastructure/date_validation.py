"""Einheitliche Datumsprüfung für Web- und Desktop-Eingaben."""

import re
from datetime import date, datetime
from typing import Any


def normalize_date(value: Any, label: str, *, required: bool = False) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ValueError(f"{label} fehlt.")
        return None

    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    raw = str(value).strip()
    if re.fullmatch(r"\d{2}([.-])\d{2}\1\d{4}", raw):
        raw = f"{raw[6:10]}-{raw[3:5]}-{raw[0:2]}"

    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            raise ValueError
        return date.fromisoformat(raw).isoformat()
    except ValueError as error:
        raise ValueError(
            f"{label}: Bitte ein gültiges Datum mit vierstelliger Jahreszahl eingeben."
        ) from error


def normalize_inventory_dates(payload: dict[str, Any]) -> dict[str, Any]:
    """Prüft vor dem ersten Schreibzugriff; verändert das Original nicht."""
    result = dict(payload)
    for key in ("asset", "stock"):
        values = payload.get(key)
        if not isinstance(values, dict):
            continue
        values = dict(values)
        purchase = normalize_date(values.get("purchase_date"), "Kaufdatum", required=True)
        values["purchase_date"] = purchase
        if key == "asset":
            warranty = normalize_date(values.get("warranty_until"), "Garantie bis")
            if warranty and purchase and warranty < purchase:
                raise ValueError("Garantie bis darf nicht vor dem Kaufdatum liegen.")
            values["warranty_until"] = warranty
        result[key] = values
    return result
