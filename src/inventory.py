from __future__ import annotations

import json
from typing import Any

# ---------------------------------------------------------------------------
# Fachliche Codes
# ---------------------------------------------------------------------------
# Die grobe Gruppierung kommt primär aus product_categories.inventory_group.
# Die Code-Sets bleiben nur als Fallback für ältere/teilweise geladene Daten.

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

CATEGORY_LABELS = {
    "barcode_scanner": "Barcodescanner",
    "cable": "Kabel",
    "cpu": "Prozessoren",
    "desktop_pc": "Computer",
    "headset": "Headsets",
    "keyboard": "Tastaturen",
    "lamp": "Lampen",
    "laptop": "Notebooks",
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
    "component": "Komponenten / Ersatzteile",
    "consumable": "Verbrauchsmaterial",
    "other": "Sonstiges",
}

STATUS_LABELS = {
    "available": "Verfügbar",
    "in_use": "Im Einsatz",
    "defective": "Defekt",
    "in_repair": "In Reparatur",
    "retired": "Ausgemustert",
    # Zukunftskompatibel, falls die empfohlene Statusvereinfachung später kommt.
    "active": "Aktiv",
}

TRACKING_MODE_LABELS = {
    "serialized": "Einzeln",
    "quantity": "Menge",
    "hybrid": "Hybrid",
}

USAGE_STATE_LABELS = {
    "installed": "Eingebaut",
    "assigned": "Zugewiesen",
    "stored": "Im Lager",
    "unlocated": "Nicht zugeordnet",
}

# ---------------------------------------------------------------------------
# Tabellenansicht
# ---------------------------------------------------------------------------
# Reihenfolge basiert auf dem aktuellen Supabase-Schema. Zusätzliche spätere
# Spalten werden vom Tabellen-Widget weiterhin automatisch hinten ergänzt.

PREFERRED_COLUMN_ORDER = [
    "id",
    "asset_tag",
    "serial_number",
    "product_model_name",
    "manufacturer_name",
    "product_category_name",
    "product_category_code",
    "product_category_inventory_group",
    "inventory_usage",
    "current_usage_state",
    "installed_in",
    "installed_slot",
    "assigned_to",
    "storage_location",
    "status",
    "product_model_tracking_mode",
    "product_model_part_number",
    "product_model_specifications",
    "product_model_id",
    "purchase_date",
    "purchase_cost",
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
    "inventory_usage",
    "installed_in",
    "assigned_to",
    "storage_location",
    "status",
}

HEADER_LABELS = {
    "id": "ID",
    "product_model_id": "Produktmodell-ID",
    "asset_tag": "Asset-Tag",
    "serial_number": "Seriennummer",
    "purchase_date": "Kaufdatum",
    "purchase_cost": "Kaufpreis",
    "warranty_until": "Garantie bis",
    "retired_at": "Ausgemustert am",
    "note": "Bemerkungen",
    "created_at": "Erstellt am",
    "updated_at": "Geändert am",
    "status": "Status",
    "product_model_name": "Produktmodell",
    "product_model_manufacturer_id": "Hersteller-ID",
    "product_model_category_id": "Kategorie-ID",
    "product_model_part_number": "Artikelnummer",
    "product_model_specifications": "Spezifikationen",
    "product_model_tracking_mode": "Bestandsführung",
    "product_model_is_active": "Modell aktiv",
    "product_category_id": "Kategorie-ID",
    "product_category_name": "Produktkategorie",
    "product_category_code": "Kategoriecode",
    "product_category_inventory_group": "Inventartyp",
    "manufacturer_name": "Hersteller",
    "inventory_usage": "Verwendung",
    "current_usage_state": "Nutzungszustand (Code)",
    "installed_in": "Eingebaut in",
    "installed_in_asset_id": "Eltern-Asset-ID",
    "installed_slot": "Steckplatz",
    "assigned_to": "Zugewiesen an",
    "assigned_employee_id": "Mitarbeiter-ID",
    "assigned_department_id": "Abteilungs-ID",
    "storage_location": "Lagerort",
    "storage_location_id": "Lagerort-ID",
}

NAME_FIELDS = (
    "asset_tag",
    "serial_number",
    "product_model_name",
    "manufacturer_name",
    "product_category_name",
    "assigned_to",
    "storage_location",
)


def get_category_key(asset: dict[str, Any]) -> str | None:
    """Liefert einen stabilen Schlüssel für den Kategorie-Checkboxfilter."""

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
    """Liefert eine gut lesbare deutsche Kategoriebezeichnung."""

    code = str(asset.get("product_category_code") or "").strip().casefold()
    if code in CATEGORY_LABELS:
        return CATEGORY_LABELS[code]

    for field_name in (
        "product_category_name",
        "product_category_code",
        "product_category_id",
        "product_model_category_id",
    ):
        value = asset.get(field_name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return "Unbekannte Kategorie"


def get_inventory_group(asset: dict[str, Any]) -> str:
    """Bestimmt den Inventartyp, primär aus product_categories.inventory_group."""

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
    """Formatiert technische Datenbankcodes nur für die Anzeige."""

    if value is None:
        return ""

    if isinstance(value, bool):
        return "Ja" if value else "Nein"

    normalized = str(value).strip().casefold() if isinstance(value, str) else ""

    if column_name == "status" and normalized in STATUS_LABELS:
        return STATUS_LABELS[normalized]
    if column_name == "product_model_tracking_mode" and normalized in TRACKING_MODE_LABELS:
        return TRACKING_MODE_LABELS[normalized]
    if column_name == "product_category_inventory_group" and normalized in INVENTORY_GROUP_LABELS:
        return INVENTORY_GROUP_LABELS[normalized]
    if column_name == "current_usage_state" and normalized in USAGE_STATE_LABELS:
        return USAGE_STATE_LABELS[normalized]

    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)

    return str(value)