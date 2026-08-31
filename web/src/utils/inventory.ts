import type { InventoryRow } from "../types/inventory";

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function getRowKey(row: InventoryRow): string {
  const recordType = normalizeText(row._record_type ?? "asset");

  if (recordType === "stock") {
    return [
      "stock",
      row.id ?? "",
      row.product_model_id ?? "",
      row.storage_location_id ?? "",
      row.condition ?? "",
    ].join(":");
  }

  return [
    "asset",
    row.id ?? row.asset_tag ?? row.serial_number ?? "",
  ].join(":");
}

export function getIdentifier(row: InventoryRow): string {
  for (const field of [
    "asset_tag",
    "product_model_name",
    "serial_number",
    "id",
  ]) {
    const value = row[field];

    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "Unbekannter Eintrag";
}
