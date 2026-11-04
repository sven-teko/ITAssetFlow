"""Optionale QR-Kennungen und EAN-8/EAN-13 mit unveränderten führenden Nullen."""
import re
from typing import Any


def normalize_mac(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("Die MAC-Adresse muss Text enthalten.")
    text = re.sub(r"^MAC(?:[- ]?(?:Adresse|Address))?\s*[:=]\s*", "", value.strip(), flags=re.I)
    if not re.fullmatch(r"(?:[a-f\d]{12}|(?:[a-f\d]{2}:){5}[a-f\d]{2}|(?:[a-f\d]{2}-){5}[a-f\d]{2}|(?:[a-f\d]{4}\.){2}[a-f\d]{4})", text, re.I):
        raise ValueError("Bitte eine gültige MAC-Adresse mit 12 Hexadezimalzeichen eingeben.")
    compact = re.sub(r"[:.\-]", "", text).upper()
    return ":".join(compact[index:index+2] for index in range(0, 12, 2))


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


def _normalize_gtin(value: Any, pattern: str, label: str, lengths: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} bitte als Text eingeben, damit führende Nullen erhalten bleiben.")
    value = value.strip()
    if not value:
        return None
    if not re.fullmatch(pattern, value):
        raise ValueError(f"{label} muss {lengths} Ziffern enthalten.")
    total = sum(int(digit) * (3 if index % 2 == 0 else 1)
                for index, digit in enumerate(reversed(value[:-1])))
    if (10 - total % 10) % 10 != int(value[-1]):
        raise ValueError(f"Die Prüfziffer für {label} ist ungültig. Bitte den Barcode erneut prüfen.")
    return value


def normalize_ean(value: Any) -> str | None:
    return _normalize_gtin(value, r"(?:[0-9]{8}|[0-9]{13})", "EAN", "8 oder 13")


def normalize_upc(value: Any) -> str | None:
    return _normalize_gtin(value, r"[0-9]{12}", "UPC-A", "12")


def code_values(data: dict[str, Any]) -> dict[str, str | None]:
    """Nur übergebene Felder ändern: ältere Clients behalten vorhandene Codes."""
    return {key: normalize(data[key]) for key, normalize in
            (("qr_code", normalize_qr), ("ean", normalize_ean), ("upc", normalize_upc)) if key in data}
