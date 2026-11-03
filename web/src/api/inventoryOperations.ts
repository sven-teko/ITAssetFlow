import { API_BASE } from "./config";
import { getInventoryClientId } from "./inventoryApi";
import { QrRequestError } from "./qrApi";

export type MoveDestination = {
  sites: { id: number; name: string }[];
  departments: { id: number; name: string }[];
  storage_locations: { id: number; site_id: number; department_id: number; name: string; is_active: boolean }[];
};

export async function loadMoveDestinations(signal: AbortSignal): Promise<MoveDestination> {
  const response = await fetch(`${API_BASE}/api/inventory/form-data`, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) throw new QrRequestError("Die Ziellagerorte konnten nicht geladen werden.", response.status);
  return response.json();
}

export async function saveInventoryOperation(kind: "move" | "stock", payload: Record<string, unknown>): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/inventory/${kind}`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-Inventory-Client-Id": getInventoryClientId() },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new QrRequestError("Die Verbindung wurde unterbrochen.", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.saved !== true) {
    const message = typeof data?.detail === "string" ? data.detail : data?.detail?.message;
    throw new QrRequestError(message ?? "Die Buchung wurde nicht bestätigt.", response.ok ? 502 : response.status, data?.detail?.available);
  }
}
