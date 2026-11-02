import { API_BASE } from "./config";
import type { InventoryRow } from "../types/inventory";
import { UnauthorizedError } from "./inventoryApi";
export type ArchiveReason = { reason: "customer" | "defective" | "retired" | "lost" | "other"; customer_name: string | null; destroyed: boolean | null; note: string | null };
export type ArchivedItem = ArchiveReason & { id: string; source_key: string; label: string; snapshot: InventoryRow; archived_at: string; archived_by_name: string };
export const REASON_LABELS = { customer: "Bei Kunde", defective: "Defekt", retired: "Ausgemustert", lost: "Verloren", other: "Anderer Grund" };
export async function loadArchive(offset: number, signal: AbortSignal): Promise<{ items: ArchivedItem[]; total: number }> {
  const response = await fetch(`${API_BASE}/api/archive?offset=${offset}`, { credentials: "include", cache: "no-store", signal });
  if (response.status === 401) throw new UnauthorizedError();
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "Das Archiv konnte nicht geladen werden.");
  return data;
}
export async function saveItemImage(key: string, image: Blob | null): Promise<void> {
  const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(key)}/image`, {
    method: image ? "POST" : "DELETE", credentials: "include",
    ...(image ? { body: image, headers: { "Content-Type": "image/webp" } } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.detail === "string" ? data.detail : "Das Artikelbild konnte nicht gespeichert werden.");
  }
}
