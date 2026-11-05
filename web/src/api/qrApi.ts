import type { CodeType } from "../utils/scannerCodes";
import { API_BASE } from "./config";
import { getInventoryClientId } from "./inventoryApi";

export type QrMatch = {
  key: string;
  record_type: "asset" | "stock";
  id?: number;
  asset_tag?: string;
  serial_number?: string;
  mac_address?: string;
  qr_code?: string | null;
  product_model_id: number;
  product_model_name: string;
  storage_location_id: number | null;
  storage_location_name: string;
  site_name: string;
  department_name: string;
  condition: string;
  status?: string;
  quantity: number;
};

export type QrLocation = {
  id: number;
  storage_location_name: string;
  site_name: string;
  department_name: string;
};

export type QrLookup = { code: string; code_type?: CodeType; preferred_key?: string | null; matches: QrMatch[]; locations: QrLocation[];
  models?: { id: number; name: string; tracking_mode: string }[]; direct_asset_keys?: string[]; device_match_keys?: string[] };

export type QrDeviceDetails = {
  serial_number: string | null;
  mac_address: string | null;
  condition: string | null;
  status: string | null;
  has_power_supply: boolean | null;
  image_id: string | null;
};

export class QrRequestError extends Error {
  status: number;
  available?: number;
  constructor(message: string, status: number, available?: number) { super(message); this.status = status; this.available = available; }
}

async function request(path: string, options?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/scanner/${path}`, { credentials: "include", ...options });
  } catch {
    throw new QrRequestError("Die Verbindung zur API wurde unterbrochen.", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new QrRequestError(
    typeof data?.detail === "string" ? data.detail : data?.detail?.message ?? "Die Scanner-Anfrage ist fehlgeschlagen.",
    response.status, data?.detail?.available,
  );
  return data;
}

export async function lookupQr(code: string, signal?: AbortSignal, codeType: CodeType = "auto", deviceOnly = false): Promise<QrLookup> {
  const data = await request(`lookup?code=${encodeURIComponent(code)}&code_type=${codeType}${deviceOnly ? "&device_only=true" : ""}`, { signal }) as QrLookup | null;
  if (!data || !Array.isArray(data.matches) || !Array.isArray(data.locations)) {
    throw new QrRequestError("Die Antwort zum Code ist unvollständig.", 500);
  }
  return data;
}

export async function loadQrDeviceDetails(key: string, signal: AbortSignal): Promise<QrDeviceDetails> {
  const match = /^asset:(\d+)$/.exec(key);
  if (!match) throw new Error("Ungültige Gerätekennung.");
  const data = await request(`assets/${match[1]}`, { signal, cache: "no-store" }) as QrDeviceDetails | null;
  if (!data || typeof data !== "object" || !("has_power_supply" in data)) {
    throw new Error("Die Gerätedetails konnten nicht geladen werden.");
  }
  return data;
}

export async function adjustQrStock(payload: Record<string, unknown>): Promise<{
  saved: boolean; quantity: number | null; changed_quantity: number; asset_count: number;
}> {
  const data = await request("stock", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-ITAssetFlow-Client-ID": getInventoryClientId() },
    body: JSON.stringify(payload),
  }) as { saved?: unknown; quantity?: unknown; changed_quantity?: unknown; asset_count?: unknown } | null;
  if (data?.saved !== true || (data.quantity !== null && (typeof data.quantity !== "number" || !Number.isFinite(data.quantity) || data.quantity < 0))
    || typeof data.changed_quantity !== "number" || !Number.isFinite(data.changed_quantity) || data.changed_quantity <= 0) {
    throw new QrRequestError("Die Buchungsbestätigung ist unvollständig. Bitte Bestand neu prüfen.", 500);
  }
  return { saved: true, quantity: data.quantity as number | null, changed_quantity: data.changed_quantity, asset_count: Number(data.asset_count??0) };
}
