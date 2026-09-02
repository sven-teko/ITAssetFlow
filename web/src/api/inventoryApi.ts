import type {
  CsvImportResult,
  DeleteInventoryResult,
  InventoryMeta,
  InventoryRow,
} from "../types/inventory";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL
  ?? `${window.location.protocol}//${window.location.hostname}:8000`;


const CLIENT_ID_STORAGE_KEY =
  "itassetflow.web_client_id";

function createClientId(): string {
  if (
    typeof crypto !== "undefined"
    && typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join("-");
}

export function getInventoryClientId(): string {
  try {
    const existing =
      sessionStorage.getItem(
        CLIENT_ID_STORAGE_KEY,
      );

    if (existing?.trim()) {
      return existing.trim();
    }

    const created =
      createClientId();

    sessionStorage.setItem(
      CLIENT_ID_STORAGE_KEY,
      created,
    );

    return created;

  } catch {
    // Fallback für Browsermodi, in denen sessionStorage deaktiviert ist.
    return createClientId();
  }
}

export function inventoryEventsUrl(): string {
  return (
    `${API_BASE}/api/inventory/events`
    + `?client_id=${encodeURIComponent(getInventoryClientId())}`
  );
}

function mutationHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    ...headers,
    "X-ITAssetFlow-Client-ID":
      getInventoryClientId(),
  };
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Nicht angemeldet.");
    this.name = "UnauthorizedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetail(data: unknown, fallback: string): string {
  if (isRecord(data)) {
    const detail = data.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }

  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function ensureAuthorized(response: Response): void {
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
}

export async function loadInventoryRows(): Promise<InventoryRow[]> {
  const response = await fetch(`${API_BASE}/api/inventory`, {
    credentials: "include",
  });

  ensureAuthorized(response);
  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(
      errorDetail(data, "Inventardaten konnten nicht geladen werden."),
    );
  }

  if (!Array.isArray(data)) {
    throw new Error(
      "Der Webserver hat keine gültige Inventarliste zurückgegeben.",
    );
  }

  return data.filter(
    (row): row is InventoryRow => isRecord(row),
  );
}

export async function loadInventoryMeta(): Promise<InventoryMeta> {
  const response = await fetch(`${API_BASE}/api/inventory/meta`, {
    credentials: "include",
  });

  ensureAuthorized(response);
  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(
      errorDetail(data, "Tabelleninformationen konnten nicht geladen werden."),
    );
  }

  if (!isRecord(data)) {
    throw new Error("Ungültige Tabelleninformationen vom Webserver.");
  }

  return data as InventoryMeta;
}

export async function deleteInventoryEntries(
  entryKeys: string[],
): Promise<DeleteInventoryResult> {
  const response = await fetch(`${API_BASE}/api/inventory/delete`, {
    method: "POST",
    credentials: "include",
    headers: mutationHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ entry_keys: entryKeys }),
  });

  ensureAuthorized(response);
  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(
      errorDetail(data, "Inventareinträge konnten nicht gelöscht werden."),
    );
  }

  return isRecord(data) ? data : {};
}

export async function importInventoryCsv(file: File): Promise<CsvImportResult> {
  const response = await fetch(`${API_BASE}/api/transfer/import/csv`, {
    method: "POST",
    credentials: "include",
    headers: mutationHeaders({
      "Content-Type": "text/csv",
    }),
    body: file,
  });

  ensureAuthorized(response);
  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(errorDetail(data, "CSV-Import ist fehlgeschlagen."));
  }

  return isRecord(data) ? data : {};
}

export async function exportInventoryCsv(): Promise<{
  blob: Blob;
  filename: string;
}> {
  const response = await fetch(`${API_BASE}/api/transfer/export/csv`, {
    method: "GET",
    credentials: "include",
  });

  ensureAuthorized(response);

  if (!response.ok) {
    const data = await readJson(response);
    throw new Error(errorDetail(data, "CSV-Export ist fehlgeschlagen."));
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = /filename="?([^";]+)"?/i.exec(disposition);

  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1]?.trim() || "ITAssetFlow.csv",
  };
}

export async function logoutWebSession(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
