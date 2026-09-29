import { getInventoryClientId, UnauthorizedError } from "./inventoryApi";
import type { ProductModel, ProductModelsData } from "../utils/productModels";

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ?? `${window.location.protocol}//${window.location.hostname}:8000`;

async function request(path: string, options: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_BASE}/api/product-models${path}`, {
    ...options,
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) throw new UnauthorizedError();
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : "Die Produktmodelle konnten nicht verarbeitet werden.");
  }
  return data;
}

export async function loadProductModels(signal: AbortSignal): Promise<ProductModelsData> {
  const data = await request("", { signal }) as ProductModelsData | null;
  if (!data || !Array.isArray(data.product_models) || !Array.isArray(data.product_categories) || !Array.isArray(data.manufacturers)) {
    throw new Error("Der Server hat keine gültigen Produktmodelldaten zurückgegeben.");
  }
  return data;
}

async function writeProductModel(method: "POST" | "PUT", changes: Record<string, unknown>, id?: string | number): Promise<ProductModel> {
  const data = await request(id === undefined ? "" : `/${encodeURIComponent(id)}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-ITAssetFlow-Client-ID": getInventoryClientId(),
    },
    body: JSON.stringify(changes),
  }) as ProductModel | null;
  if (!data || data.id === null || data.id === undefined || (id !== undefined && String(data.id) !== String(id)) || typeof data.name !== "string") {
    throw new Error("Die Speicherbestätigung ist unvollständig. Bitte die Modellliste neu laden.");
  }
  return data;
}

export function saveProductModel(id: string | number, changes: Record<string, unknown>): Promise<ProductModel> {
  return writeProductModel("PUT", changes, id);
}

export function createProductModel(values: Record<string, unknown>): Promise<ProductModel> {
  return writeProductModel("POST", values);
}

export async function deleteProductModel(id: string | number): Promise<void> {
  const data = await request(`/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-ITAssetFlow-Client-ID": getInventoryClientId() },
  }) as { id?: string | number } | null;
  if (!data || String(data.id) !== String(id)) {
    throw new Error("Die Löschbestätigung ist unvollständig. Bitte die Seite neu laden.");
  }
}
