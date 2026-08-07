from __future__ import annotations

import json
from typing import Any

# ---------------------------------------------------------------------------
# Fachliche Codes
# ---------------------------------------------------------------------------
# Die grobe Gruppierung kommt primär aus product_categories.inventory_group.
# Die Code-Sets bleiben als Fallback, falls Zusatzdaten einmal unvollständig sind.

DEVICE_CATEGORY_CODES = {
    "barcode_scanner",
    "desktop_pc",
    "laptop",
    "lcd_display",
    "network_switch",
    "phone",
    "pos_terminal",
    "printer",
    "restaurant_pager",
    "router",
    "server",
    "stereo_system",
    "surveillance_camera",
    "tablet",
    "wifi_extender",
}

PERIPHERAL_CATEGORY_CODES = {
    "cable",
    "headset",
    "keyboard",
    "lamp",
    "monitor",
    "mouse",
    "power_adapter",
}

COMPONENT_CATEGORY_CODES = {
    "cpu",
    "memory",
    "ram",  # Kompatibilität mit älteren Datenständen
    "motherboard",
    "power_supply",
    "storage_drive",
}

# Einheitliche UI-Bezeichnungen. Die Datenbank-Codes bleiben technisch stabil,
# die sichtbaren Namen werden überall (Tabelle + Filter) aus dieser Map erzeugt.
CATEGORY_LABELS = {
    "barcode_scanner": "Barcodescanner",
    "cable": "Kabel",
    "cpu": "Prozessoren",
    "desktop_pc": "Computer",
    "headset": "Headsets",
    "keyboard": "Tastaturen",
    "lamp": "Lampen",
    "laptop": "Laptops",
    "lcd_display": "LCD-Anzeigen",
    "memory": "Arbeitsspeicher",
    "ram": "Arbeitsspeicher",
    "monitor": "Monitore",
    "motherboard": "Mainboards",
    "mouse": "Mäuse",
    "network_switch": "Switches",
    "phone": "Telefone",
    "pos_terminal": "Kassen",
    "power_adapter": "Stromadapter",
    "power_supply": "Netzteile",
    "printer": "Drucker",
    "restaurant_pager": "Restaurant-Pager",
    "router": "Router",
    "server": "Server",
    "stereo_system": "Stereoanlagen",
    "storage_drive": "Datenträger",
    "surveillance_camera": "Überwachungskameras",
    "tablet": "Tablets",
    "wifi_extender": "WLAN-Extender",
}

INVENTORY_GROUP_LABELS = {
    "device": "Geräte",
    "peripheral": "Peripherie",
    "component": "Komponenten",
    "consumable": "Verbrauchsmaterial",
    "other": "Sonstiges",
}

STATUS_LABELS = {
    "available": "Verfügbar",
    "in_use": "Im Einsatz",
    "defective": "Defekt",
    "in_repair": "In Reparatur",
    "retired": "Ausgemustert",
    "active": "Aktiv",
}

TRACKING_MODE_LABELS = {
    "serialized": "Einzeln",
    "quantity": "Menge",
    "hybrid": "Hybrid",
}

USAGE_STATE_LABELS = {
    "connected": "Verbunden",
    "installed": "Verbunden",  # Fallback für ältere Datenstände
    "assigned": "Zugewiesen",
    "stored": "Im Lager",
    "unlocated": "Nicht zugeordnet",
}

# ---------------------------------------------------------------------------
# Tabellenansicht
# ---------------------------------------------------------------------------
# Es werden bewusst nur fachlich relevante Spalten zugelassen.
# Interne IDs, Codes und rohe JSON-Felder bleiben in Supabase erhalten,
# erscheinen aber nicht als Tabellenspalten bzw. Spaltenfilter.

PREFERRED_COLUMN_ORDER = [
    "asset_tag",
    "serial_number",
    "product_model_name",
    "manufacturer_name",
    "product_category_name",
    "department_name",
    "storage_location",
    "connected_product",
    "status",
    "product_model_part_number",
    "purchase_date",
    "new_price",
    "warranty_until",
    "retired_at",
    "note",
    "created_at",
    "updated_at",
]

DEFAULT_VISIBLE_COLUMNS = {
    "asset_tag",
    "serial_number",
    "product_model_name",
    "manufacturer_name",
    "product_category_name",
    "department_name",
    "storage_location",
    "connected_product",
    "status",
}

HEADER_LABELS = {
    "asset_tag": "Asset-Tag",
    "serial_number": "Seriennummer",
    "product_model_name": "Produktmodell",
    "manufacturer_name": "Hersteller",
    "product_category_name": "Produktkategorie",
    "department_name": "Abteilung",
    "storage_location": "Lagerort",
    "connected_product": "Verbundenes Produkt",
    "status": "Status",
    "product_model_part_number": "Artikelnummer",
    "purchase_date": "Kaufdatum",
    "new_price": "Neupreis",
    "warranty_until": "Garantie bis",
    "retired_at": "Ausgemustert am",
    "note": "Bemerkungen",
    "created_at": "Erstellt am",
    "updated_at": "Geändert am",
}

NAME_FIELDS = (
    "asset_tag",
    "serial_number",
    "product_model_name",
    "manufacturer_name",
    "product_category_name",
    "department_name",
    "storage_location",
    "connected_product",
)


def get_category_key(asset: dict[str, Any]) -> str | None:
    """Liefert einen stabilen technischen Schlüssel für den Kategorie-Filter."""

    for field_name in (
        "product_category_code",
        "product_category_id",
        "product_model_category_id",
        "product_category_name",
    ):
        value = asset.get(field_name)
        if value is not None and str(value).strip():
            return str(value).strip().casefold()
    return None


def get_category_label(asset: dict[str, Any]) -> str:
    """Liefert überall dieselbe sichtbare Kategoriebezeichnung."""

    code = str(asset.get("product_category_code") or "").strip().casefold()
    if code in CATEGORY_LABELS:
        return CATEGORY_LABELS[code]

    value = asset.get("product_category_name")
    if value is not None and str(value).strip():
        return str(value).strip()

    if code:
        return code

    return "Unbekannte Kategorie"


def get_inventory_group(asset: dict[str, Any]) -> str:
    """Bestimmt den Inventartyp primär aus product_categories.inventory_group."""

    database_group = asset.get("product_category_inventory_group")
    if database_group is not None:
        normalized = str(database_group).strip().casefold()
        aliases = {
            "device": "device",
            "geraet": "device",
            "gerät": "device",
            "peripheral": "peripheral",
            "peripherie": "peripheral",
            "component": "component",
            "komponente": "component",
            "spare_part": "component",
            "ersatzteil": "component",
            "consumable": "consumable",
            "verbrauchsmaterial": "consumable",
            "other": "other",
            "sonstiges": "other",
        }
        if normalized in aliases:
            return aliases[normalized]

    code = str(asset.get("product_category_code") or "").strip().casefold()
    if code in DEVICE_CATEGORY_CODES:
        return "device"
    if code in PERIPHERAL_CATEGORY_CODES:
        return "peripheral"
    if code in COMPONENT_CATEGORY_CODES:
        return "component"
    return "other"


def get_asset_identifier(asset: dict[str, Any] | None) -> str:
    if asset is None:
        return "Unbekanntes Asset"

    for field_name in (
        "asset_tag",
        "product_model_name",
        "serial_number",
        "id",
    ):
        value = asset.get(field_name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return "Unbekanntes Asset"


def format_inventory_value(column_name: str, value: Any) -> str:
    """Formatiert technische Datenbankwerte für die deutsche UI."""

    if value is None:
        return ""

    if isinstance(value, bool):
        return "Ja" if value else "Nein"

    normalized = str(value).strip().casefold() if isinstance(value, str) else ""

    if column_name == "status" and normalized in STATUS_LABELS:
        return STATUS_LABELS[normalized]

    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)

    return str(value)