import type { InventoryMeta } from "../types/inventory";

// Display labels only. Inventory data and authorization always come from the API.
export const DEFAULT_INVENTORY_META: InventoryMeta = {
  "column_order": [
    "asset_tag",
    "serial_number",
    "product_model_name",
    "manufacturer_name",
    "product_category_name",
    "condition",
    "stock_quantity",
    "site_name",
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
    "updated_at"
  ],
  "default_visible_columns": [
    "asset_tag",
    "serial_number",
    "product_model_name",
    "manufacturer_name",
    "product_category_name",
    "condition",
    "stock_quantity",
    "site_name",
    "department_name",
    "storage_location",
    "status"
  ],
  "headers": {
    "asset_tag": "Asset-Tag",
    "serial_number": "Seriennummer",
    "product_model_name": "Produktmodell",
    "manufacturer_name": "Hersteller",
    "product_category_name": "Produktkategorie",
    "condition": "Zustand",
    "stock_quantity": "Lagerbestand",
    "site_name": "Standort",
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
    "updated_at": "Geändert am"
  },
  "status_labels": {
    "available": "Verfügbar",
    "in_use": "Im Einsatz",
    "defective": "Defekt",
    "in_repair": "In Reparatur",
    "retired": "Ausgemustert",
    "active": "Aktiv"
  },
  "condition_labels": {
    "new": "Neu",
    "like_new": "Neuwertig",
    "used": "Gebraucht",
    "worn": "Stark gebraucht",
    "defective": "Defekt"
  },
  "inventory_group_labels": {
    "device": "Geräte",
    "peripheral": "Peripherie",
    "component": "Komponenten",
    "consumable": "Verbrauchsmaterial",
    "other": "Sonstiges"
  }
};
