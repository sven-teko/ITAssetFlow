import { API_BASE } from "./config";
import type {
  CsvImportResult,
  DeleteInventoryResult,
  InventoryMeta,
  InventoryRow,
} from "../types/inventory";


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

export class InventoryMetaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "InventoryMetaError";
    this.status = status;
  }
  get allowsDefaultColumns(): boolean {
    return this.status === 0 || this.status === 200 || this.status === 404 || this.status >= 500;
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

export async function loadInventoryRevision(): Promise<number> {
  const response = await fetch(
    `${API_BASE}/api/inventory/revision`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );

  ensureAuthorized(response);

  const data =
    await readJson(
      response,
    );

  if (!response.ok) {
    throw new Error(
      errorDetail(
        data,
        "Änderungsstand des Inventars konnte nicht geprüft werden.",
      ),
    );
  }

  if (
    !isRecord(
      data,
    )
  ) {
    throw new Error(
      "Der Webserver hat keinen gültigen Inventar-Änderungsstand zurückgegeben.",
    );
  }

  const revision =
    Number(
      data.revision,
    );

  if (
    !Number.isFinite(
      revision,
    )
  ) {
    throw new Error(
      "Der Inventar-Änderungsstand des Webservers ist ungültig.",
    );
  }

  return revision;
}


export async function loadInventoryMeta(): Promise<InventoryMeta> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/inventory/meta`, { credentials: "include" });
  } catch {
    throw new InventoryMetaError("Die Tabellenansicht konnte nicht abgerufen werden.", 0);
  }

  ensureAuthorized(response);
  const data = await readJson(response);

  if (!response.ok) {
    throw new InventoryMetaError(
      errorDetail(data, `Tabelleninformationen konnten nicht geladen werden (HTTP ${response.status}).`), response.status,
    );
  }

  if (!isRecord(data)
      || !Array.isArray(data.column_order) || !data.column_order.length || !data.column_order.every(value => typeof value === "string")
      || !Array.isArray(data.default_visible_columns) || !data.default_visible_columns.every(value => typeof value === "string")
      || !["headers", "status_labels", "condition_labels", "inventory_group_labels"].every(key => isRecord(data[key]) && Object.values(data[key]).every(value => typeof value === "string"))) {
    throw new InventoryMetaError("Die Tabelleninformationen vom Webserver sind unvollständig.", 200);
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

export type ExportFormat = "csv" | "postgresql";

export async function exportInventoryFile(format: ExportFormat): Promise<{
  blob: Blob;
  filename: string;
}> {
  const response = await fetch(`${API_BASE}/api/transfer/export/${format}`, {
    method: "GET",
    credentials: "include",
  });

  ensureAuthorized(response);

  if (!response.ok) {
    const data = await readJson(response);
    const label = format === "csv" ? "CSV" : "PostgreSQL";
    throw new Error(errorDetail(data, `${label}-Export ist fehlgeschlagen.`));
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = /filename="?([^";]+)"?/i.exec(disposition);

  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1]?.trim() || `ITAssetFlow.${format === "csv" ? "csv" : "sql"}`,
  };
}

export async function logoutWebSession(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
