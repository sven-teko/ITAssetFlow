"""Optionale QR-Kennungen und EAN-8/EAN-13 mit unveränderten führenden Nullen."""
import re
from typing import Any


def normalize_qr(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("Der QR-Code muss Text enthalten.")
    value = value.strip()
    if not value:
        return None
    if len(value) > 100 or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError("Der QR-Code darf höchstens 100 Zeichen und keine Steuerzeichen enthalten.")
    return value


def normalize_ean(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("EAN bitte als Text eingeben, damit führende Nullen erhalten bleiben.")
    value = value.strip()
    if not value:
        return None
    if not re.fullmatch(r"(?:[0-9]{8}|[0-9]{13})", value):
        raise ValueError("EAN muss 8 oder 13 Ziffern enthalten.")
    total = sum(int(digit) * (3 if index % 2 == 0 else 1)
                for index, digit in enumerate(reversed(value[:-1])))
    if (10 - total % 10) % 10 != int(value[-1]):
        raise ValueError("Die EAN-Prüfziffer ist ungültig. Bitte den Barcode erneut prüfen.")
    return value


def code_values(data: dict[str, Any]) -> dict[str, str | None]:
    """Nur übergebene Felder ändern: ältere Clients behalten vorhandene Codes."""
    return {key: normalize(data[key]) for key, normalize in
            (("qr_code", normalize_qr), ("ean", normalize_ean)) if key in data}
