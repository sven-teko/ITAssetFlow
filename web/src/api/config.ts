// Ein leerer Wert bedeutet ausdrücklich dieselbe Origin (z. B. Standalone).
// Beim IIS-Betrieb spricht der Browser die API direkt auf Port 8000 an.
const configuredBase = import.meta.env.VITE_API_BASE_URL;

export const API_BASE = configuredBase === undefined
  ? (window.location.hostname.endsWith(".onrender.com") ? "" : `${window.location.protocol}//${window.location.hostname}:8000`)
  : configuredBase.trim().replace(/\/+$/, "");
