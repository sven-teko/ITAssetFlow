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


CONDITION_LABELS = {
    "new": "Neu",
    "like_new": "Neuwertig",
    "used": "Gebraucht",
    "worn": "Stark gebraucht",
    "defective": "Defekt",
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
    "condition",
    "stock_quantity",
    "department_name",
    "storage_location",
    "connected_product",
    "status",
    "product_model_part_number",
    "purchase_date",
    "new_price",
    "warranty_until",
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
    "condition",
    "stock_quantity",
    "department_name",
    "storage_location",
    "status",
}

HEADER_LABELS = {
    "asset_tag": "Asset-Tag",
    "serial_number": "Seriennummer",
    "product_model_name": "Produktmodell",
    "manufacturer_name": "Hersteller",
    "product_category_name": "Produktkategorie",
    "condition": "Zustand",
    "stock_quantity": "Lagerbestand",
    "department_name": "Abteilung",
    "storage_location": "Lagerort",
    "connected_product": "Verbundenes Produkt",
    "status": "Status",
    "product_model_part_number": "Artikelnummer",
    "purchase_date": "Kaufdatum",
    "new_price": "Neupreis",
    "warranty_until": "Garantie bis",
    "note": "Bemerkungen",
    "created_at": "Erstellt am",
    "updated_at": "Geändert am",
}


SPECIFICATION_COLUMN_PREFIX = "spec_"


SPECIFICATION_KEY_ALIASES = {
    # Frühere deutsche/alte JSON-Schlüssel -> heutige technische Schlüssel
    "speicher_gb": "storage_gb",
    "display_zoll": "screen_size_inch",
    "betriebssystem": "operating_system",
    "anschluss": "connection_type",
    "anschluesse": "connections",
    "anschlüsse": "connections",
    "laenge_m": "length_m",
    "länge_m": "length_m",
    "anschluss_a": "connector_a",
    "anschluss_b": "connector_b",
    "leistung_w": "power_w",
    "takt_mhz": "speed_mhz",
    "groesse_zoll": "screen_size_inch",
    "größe_zoll": "screen_size_inch",
}

SPECIFICATION_FALLBACK_LABELS = {
    "cpu": "CPU",
    "cpu_count": "Anzahl CPUs",
    "ram_gb": "RAM [GB]",
    "storage": "Datenträger",
    "storage_gb": "Speicher [GB]",
    "gpu": "Grafikkarte",
    "operating_system": "Betriebssystem",
    "form_factor": "Bauform",
    "screen_size_inch": "Bildschirmgrösse [Zoll]",
    "resolution": "Auflösung",
    "panel_type": "Paneltyp",
    "refresh_rate_hz": "Bildwiederholrate [Hz]",
    "connections": "Anschlüsse",
    "connection_type": "Anschluss",
    "printer_type": "Drucktechnik",
    "color": "Farbdruck",
    "duplex": "Duplex",
    "paper_format": "Papierformat",
    "network": "Netzwerkfähig",
    "port_count": "Ports",
    "port_speed": "Portgeschwindigkeit",
    "poe": "PoE",
    "managed": "Managed",
    "sfp_ports": "SFP/SFP+ Ports",
    "wan_ports": "WAN-Ports",
    "lan_ports": "LAN-Ports",
    "wifi_standard": "WLAN-Standard",
    "frequency_bands": "Frequenzbänder",
    "max_speed": "Max. Geschwindigkeit",
    "socket": "Sockel",
    "cores": "Kerne",
    "threads": "Threads",
    "base_clock_ghz": "Basistakt [GHz]",
    "boost_clock_ghz": "Boost-Takt [GHz]",
    "tdp_w": "TDP [W]",
    "capacity_gb": "Kapazität [GB]",
    "memory_type": "Speichertyp",
    "speed_mhz": "Takt [MHz]",
    "drive_type": "Laufwerkstyp",
    "interface": "Schnittstelle",
    "chipset": "Chipsatz",
    "memory_slots": "RAM-Steckplätze",
    "power_w": "Leistung [W]",
    "efficiency_rating": "Effizienz",
    "storage_gb": "Speicher [GB]",
    "phone_type": "Telefontyp",
    "voip": "VoIP",
    "camera_type": "Kameratyp",
    "night_vision": "Nachtsicht",
    "wireless": "Kabellos",
    "barcode_types": "Barcode-Typen",
    "layout": "Tastaturlayout",
    "microphone": "Mikrofon",
    "cable_type": "Kabeltyp",
    "length_m": "Länge [m]",
    "connector_a": "Anschluss A",
    "connector_b": "Anschluss B",
    "output_voltage_v": "Ausgangsspannung [V]",
    "connector_type": "Stecker",
    "frequency": "Frequenz",
    "range_m": "Reichweite [m]",
    "display": "Display",
    "bluetooth": "Bluetooth",
    "wifi": "WLAN",
    "lamp_type": "Lampentyp",
    "color_temperature_k": "Farbtemperatur [K]",
}


def normalize_specification_key(key: str) -> str:
    normalized = str(key or "").strip().casefold()
    return SPECIFICATION_KEY_ALIASES.get(normalized, normalized)


def normalize_specifications(value: Any) -> dict[str, Any]:
    """Normalisiert JSON-Spezifikationen, ohne unbekannte Felder zu verlieren."""

    if not isinstance(value, dict):
        return {}

    normalized: dict[str, Any] = {}
    for raw_key, raw_value in value.items():
        key = normalize_specification_key(str(raw_key))
        if not key:
            continue

        # Falls sowohl ein alter Alias als auch bereits der neue Schlüssel
        # existieren, gewinnt der explizite moderne Schlüssel.
        if key not in normalized or str(raw_key).strip().casefold() == key:
            normalized[key] = raw_value

    return normalized


def fallback_specification_label(key: str) -> str:
    normalized = normalize_specification_key(key)
    if normalized in SPECIFICATION_FALLBACK_LABELS:
        return SPECIFICATION_FALLBACK_LABELS[normalized]

    return normalized.replace("_", " ").strip().title()


def specification_column_name(key: str) -> str:
    return f"{SPECIFICATION_COLUMN_PREFIX}{key}"


def is_specification_column(column_name: str) -> bool:
    return column_name.startswith(SPECIFICATION_COLUMN_PREFIX)


def get_specification_fields(category_schema: Any) -> list[dict[str, Any]]:
    if not isinstance(category_schema, dict):
        return []

    fields = category_schema.get("fields")
    if not isinstance(fields, list):
        return []

    return [
        field for field in fields
        if isinstance(field, dict)
        and str(field.get("key") or "").strip()
    ]


def get_specification_label(field: dict[str, Any]) -> str:
    key = str(field.get("key") or "").strip()
    label = str(field.get("label") or key).strip() or key
    unit = str(field.get("unit") or "").strip()
    return f"{label} [{unit}]" if unit else label

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


def get_condition_key(item: dict[str, Any] | None) -> str | None:
    if not isinstance(item, dict):
        return None

    value = item.get("condition")
    if value is None:
        return None

    normalized = str(value).strip().casefold()
    return normalized or None


def get_condition_label(item: dict[str, Any] | None) -> str:
    key = get_condition_key(item)
    if key is None:
        return ""

    return CONDITION_LABELS.get(
        key,
        key.replace("_", " ").title(),
    )


def is_stock_record(item: dict[str, Any] | None) -> bool:
    return (
        isinstance(item, dict)
        and item.get("_record_type") == "stock"
    )


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

    if column_name == "condition" and normalized in CONDITION_LABELS:
        return CONDITION_LABELS[normalized]

    if column_name == "stock_quantity":
        try:
            number = float(value)
        except (TypeError, ValueError):
            return str(value)

        if number.is_integer():
            return str(int(number))
        return f"{number:.3f}".rstrip("0").rstrip(".")

    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)

    return str(value)