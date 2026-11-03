import { useState } from "react";
import { API_BASE } from "../api/config";

type BackupAction = "download" | "recovery-sql";

export default function BackupSettings({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [keepAuthLinks, setKeepAuthLinks] = useState(false);
  const [running, setRunning] = useState<BackupAction | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function download(action: BackupAction) {
    setRunning(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${API_BASE}/api/backup/${action}${action === "recovery-sql" ? `?keep_auth_links=${keepAuthLinks}` : ""}`, {
        credentials: "include",
        ...(action === "recovery-sql" ? { method: "POST", body: file, headers: { "Content-Type": "application/gzip" } } : {}),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : "Die Datei konnte nicht erstellt werden.");
      }
      const objectURL = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectURL;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([\w.-]+)"/)?.[1]
        ?? (action === "download" ? "ITAssetFlow_Backup.json.gz" : "ITAssetFlow_Wiederherstellung.sql");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
      setNotice(action === "download" ? "Backup erstellt." : "SQL-Datei für die Wiederherstellung erstellt.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Datei konnte nicht erstellt werden.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="settings-single-page settings-backup">
      <section className="settings-section settings-backup-card">
        <h2>Backup erstellen</h2>
        <p>Das Backup enthält Stammdaten, Inventar, Bilder, Archiv und Lagerhistorie. Anmeldekonten und Passwörter werden nicht gesichert.</p>
        <button type="button" disabled={running !== null} onClick={() => void download("download")}>
          {running === "download" ? "Backup wird erstellt …" : "Backup herunterladen"}
        </button>
      </section>
      <section className="settings-section settings-backup-card">
        <h2>Wiederherstellung vorbereiten</h2>
        <p>Wähle ein ITAssetFlow-Backup (.json.gz). Die erzeugte SQL-Datei ist für eine leere Supabase-Zieldatenbank mit dem passenden ITAssetFlow-Schema bestimmt.</p>
        <label>Backup-Datei<input type="file" accept=".gz,application/gzip" disabled={running !== null}
          onChange={event => setFile(event.currentTarget.files?.[0] ?? null)}/></label>
        <label><input type="checkbox" checked={keepAuthLinks} disabled={running !== null}
          onChange={event => setKeepAuthLinks(event.currentTarget.checked)}/> Benutzerverknüpfungen übernehmen, wenn dieselben Supabase-Konten bereits im Ziel existieren</label>
        <button type="button" disabled={running !== null || !file} onClick={() => void download("recovery-sql")}>
          {running === "recovery-sql" ? "Datei wird geprüft …" : "SQL-Datei erstellen"}
        </button>
      </section>
      <section className="settings-section settings-backup-card">
        <h2>Automatische Sicherung</h2>
        <p>Der GitHub-Workflow sichert das Inventar nach der Einrichtung jeden Sonntag um 03:17 Uhr Schweizer Zeit. Die verschlüsselten Dateien findest du unter «Actions» im privaten Repository.</p>
      </section>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="archive-error">{error}</p>}
    </div>
  );
}
