import { API_BASE } from "./config";

export const INVALID_RECOVERY_LINK = "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.";
export type RecoverySession = { ready: boolean; email?: string };

export class RecoveryError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

let accessToken: string | null = null;
let linkError = false;
let sessionRequest: Promise<RecoverySession> | null = null;

function hasRecoveryFragment(): boolean {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return ["access_token", "refresh_token", "error", "error_code"].some(key => hash.has(key));
}

export function handleRecoveryNavigation(event: Event): void {
  if (!hasRecoveryFragment()) return;
  // A link opened in the existing app tab can be a fragment-only navigation.
  // Reload before HashRouter handles it, so the recovery always starts fresh.
  event.stopImmediatePropagation();
  window.location.reload();
}

// Run before HashRouter: Supabase uses the URL fragment for recovery tokens.
// Remove all credentials from the address/history immediately; retain only the
// access token in memory until FastAPI has exchanged it for an HttpOnly cookie.
export function preparePasswordRecovery(): void {
  if (!hasRecoveryFragment()) return;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  linkError = hash.has("error") || hash.has("error_code") || hash.get("type") !== "recovery" || !hash.get("access_token");
  accessToken = linkError ? null : hash.get("access_token");
  for (const key of ["access_token", "refresh_token", "token", "token_hash", "code", "error", "error_code", "error_description"]) query.delete(key);
  const search = query.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}#/reset-password${linkError ? "?error=expired" : ""}`);
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/auth/recovery${path}`, {
      method, credentials: "include", cache: "no-store",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new RecoveryError("Die Verbindung ist unterbrochen. Bitte versuche es erneut.", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new RecoveryError(typeof data?.detail === "string" ? data.detail : "Die Anfrage konnte nicht verarbeitet werden.", response.status);
  if (!data || typeof data !== "object") throw new RecoveryError("Die Serverantwort ist unvollständig. Bitte versuche es erneut.", 502);
  return data as T;
}

export function loadRecoverySession(retry = false): Promise<RecoverySession> {
  if (linkError) return Promise.resolve({ ready: false });
  if (retry) sessionRequest = null;
  if (!sessionRequest) {
    sessionRequest = (accessToken
      ? request<RecoverySession>("/session", "POST", { access_token: accessToken })
      : request<RecoverySession>("/session")
    ).then(session => {
      if (typeof session.ready !== "boolean" || (session.ready && typeof session.email !== "string")) throw new RecoveryError("Die Serverantwort ist unvollständig. Bitte versuche es erneut.", 502);
      accessToken = null;
      return session;
    }).catch(error => {
      if (error instanceof RecoveryError && error.status === 401) accessToken = null;
      throw error;
    });
  }
  return sessionRequest;
}

export async function requestRecoveryEmail(email: string): Promise<void> {
  const result = await request<{ requested: boolean }>("/request", "POST", { email: email.trim() });
  if (result.requested !== true) throw new RecoveryError("Die Anfrage konnte nicht bestätigt werden.", 502);
}

export async function saveRecoveryPassword(password: string): Promise<void> {
  const result = await request<{ updated: boolean }>("/password", "POST", { password });
  if (result.updated !== true) throw new RecoveryError("Die Passwortänderung konnte nicht bestätigt werden.", 502);
  accessToken = null;
  sessionRequest = null;
  linkError = false;
}

export async function cancelRecovery(): Promise<void> {
  accessToken = null;
  sessionRequest = null;
  linkError = false;
  await request("/session", "DELETE");
}
