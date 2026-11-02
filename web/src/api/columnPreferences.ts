import { API_BASE } from "./config";

export type ColumnPreferences = { column_order: string[]; visible_columns: string[] };
type CachedPreferences = ColumnPreferences & { pending?: boolean };
type SaveTask = { next: ColumnPreferences | null; promise: Promise<void> };
const saves = new Map<string, SaveTask>();
const revisions = new Map<string, number>();
const account = (email: string) => email.trim().toLowerCase();
const key = (email: string) => `itassetflow.inventory_columns:v1:${account(email)}`;

function parse(value: unknown): ColumnPreferences | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const names = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0
    && v.length <= 256 && v.every(item => typeof item === "string" && /^[A-Za-z0-9_]{1,100}$/.test(item));
  if (!names(raw.column_order) || !names(raw.visible_columns)) return null;
  return { column_order: [...new Set(raw.column_order)], visible_columns: [...new Set(raw.visible_columns)] };
}

export function cachedColumnPreferences(email: string): CachedPreferences | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key(email)) ?? "null");
    const value = parse(raw);
    return value ? { ...value, pending: raw.pending === true } : null;
  } catch { return null; }
}

function cache(email: string, value: ColumnPreferences, pending: boolean): void {
  try { localStorage.setItem(key(email), JSON.stringify({ ...value, pending })); } catch { /* Das Konto bleibt auch ohne lokalen Speicher nutzbar. */ }
}

async function request(email: string, preferences?: ColumnPreferences): Promise<ColumnPreferences | null> {
  const response = await fetch(`${API_BASE}/api/preferences/inventory-columns`, {
    method: preferences ? "PUT" : "GET", credentials: "include", cache: "no-store",
    headers: { "X-ITAssetFlow-User": account(email), ...(preferences ? { "Content-Type": "application/json" } : {}) },
    ...(preferences ? { body: JSON.stringify(preferences) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.detail || "Spalteneinstellungen konnten nicht mit dem Benutzerkonto synchronisiert werden.");
  return parse(result?.preferences);
}

export function saveColumnPreferences(email: string, preferences: ColumnPreferences): Promise<void> {
  cache(email, preferences, true);
  const id = account(email), current = saves.get(id);
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  if (current) { current.next = preferences; return current.promise; }
  const task: SaveTask = { next: preferences, promise: Promise.resolve() };
  task.promise = (async () => {
    try {
      while (task.next) {
        const next = task.next;
        task.next = null;
        await request(email, next);
        if (!task.next) cache(email, next, false);
      }
    } finally { if (saves.get(id) === task) saves.delete(id); }
  })();
  saves.set(id, task);
  return task.promise;
}

export async function loadColumnPreferences(email: string): Promise<ColumnPreferences | null> {
  await saves.get(account(email))?.promise;
  const cached = cachedColumnPreferences(email);
  if (cached?.pending) {
    await saveColumnPreferences(email, { column_order: cached.column_order, visible_columns: cached.visible_columns });
    return cached;
  }
  const revision = revisions.get(account(email)) ?? 0;
  const preferences = await request(email);
  if ((revisions.get(account(email)) ?? 0) !== revision || cachedColumnPreferences(email)?.pending) {
    return cachedColumnPreferences(email);
  }
  if (preferences) cache(email, preferences, false);
  return preferences ?? cached;
}
