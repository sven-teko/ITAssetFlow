import { useEffect, useState } from "react";
import { API_BASE } from "../api/config";

type BackupAction = "download" | "recovery-sql" | "automatic";
type Frequency = "daily" | "weekly" | "monthly";
type SavedBackup = { id: number; name: string; created_at: string; size: number };
type AutomaticSettings = { configured: boolean; frequency: Frequency; backups: SavedBackup[] };
const frequencyLabels: Record<Frequency, string> = { daily: "Täglich", weekly: "Wöchentlich", monthly: "Monatlich" };
const nextRun: Record<Frequency, string> = { daily: "Jeden Tag", weekly: "Jeden Sonntag", monthly: "Am 1. jedes Monats" };
const timestamp = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" });

async function backupError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.detail === "string" ? body.detail : fallback);
}

export default function BackupSettings({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [keepAuthLinks, setKeepAuthLinks] = useState(false);
  const [running, setRunning] = useState<BackupAction | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [automatic, setAutomatic] = useState<AutomaticSettings | null>(null);
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [reloadSchedule, setReloadSchedule] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setScheduleLoading(true);
      setScheduleError("");
      try {
        const response = await fetch(`${API_BASE}/api/backup/automatic`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok) throw await backupError(response, "Automatische Sicherungen konnten nicht geladen werden.");
        const data = await response.json() as AutomaticSettings;
        if (controller.signal.aborted) return;
        setAutomatic(data);
        setFrequency(data.frequency);
      } catch (cause) {
        if (!controller.signal.aborted) setScheduleError(cause instanceof Error ? cause.message : "Sicherungen konnten nicht geladen werden.");
      } finally {
        if (!controller.signal.aborted) setScheduleLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [onSessionExpired, reloadSchedule]);

  async function saveSchedule() {
    if (!automatic?.configured || savingSchedule) return;
    setSavingSchedule(true);
    setScheduleNotice("");
    setScheduleError("");
    try {
      const response = await fetch(`${API_BASE}/api/backup/automatic`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency }),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) throw await backupError(response, "Das Sicherungsintervall konnte nicht gespeichert werden.");
      setAutomatic({ ...automatic, frequency });
      setScheduleNotice("Sicherungsintervall gespeichert.");
    } catch (cause) {
      setScheduleError(cause instanceof Error ? cause.message : "Das Sicherungsintervall konnte nicht gespeichert werden.");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function download(action: BackupAction, backup?: SavedBackup) {
    setRunning(action);
    setError("");
    setNotice("");
    try {
      const suffix = backup ? `/${backup.id}` : action === "recovery-sql" ? `?keep_auth_links=${keepAuthLinks}` : "";
      const response = await fetch(`${API_BASE}/api/backup/${action}${suffix}`, {
        credentials: "include",
        ...(action === "recovery-sql" ? { method: "POST", body: file, headers: { "Content-Type": "application/gzip" } } : {}),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) throw await backupError(response, "Die Sicherungsdatei konnte nicht geladen werden.");
      const objectURL = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectURL;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([\w.-]+)"/)?.[1]
        ?? backup?.name ?? (action === "download" ? "ITAssetFlow_Backup.json.gz" : "ITAssetFlow_Wiederherstellung.sql");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
      setNotice(action === "download" ? "Backup erstellt." : action === "automatic" ? "Sicherungsdatei heruntergeladen." : "SQL-Datei für die Wiederherstellung erstellt.");
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
        {scheduleLoading ? <p role="status">Sicherungen werden geladen …</p> : automatic && <>
          {!automatic.configured && <p>Die automatische Sicherung ist noch nicht mit einem privaten GitHub-Repository verbunden.</p>}
          <div className="backup-schedule-controls">
            <label>Sicherungsintervall
              <select value={frequency} disabled={!automatic.configured || savingSchedule}
                onChange={event => { setFrequency(event.target.value as Frequency); setScheduleNotice(""); }}>
                {(Object.entries(frequencyLabels) as [Frequency, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void saveSchedule()} disabled={!automatic.configured || savingSchedule || automatic.frequency === frequency}>
              {savingSchedule ? "Wird gespeichert …" : "Intervall speichern"}
            </button>
          </div>
          <p>{nextRun[frequency]} um 02:00 Uhr Schweizer Zeit. Die fünf neuesten verschlüsselten Sicherungen werden aufbewahrt.</p>
          {automatic.configured && <div className="backup-saved">
            <h3>Letzte Sicherungen</h3>
            {automatic.backups.length === 0 ? <p>Noch keine automatische Sicherung vorhanden.</p> : <ul>
              {automatic.backups.slice(0, 5).map(item => <li key={item.id}>
                <time dateTime={item.created_at}>{timestamp.format(new Date(item.created_at))} Uhr</time>
                <button type="button" disabled={running !== null} onClick={() => void download("automatic", item)}
                  aria-label={`Sicherung vom ${timestamp.format(new Date(item.created_at))} herunterladen`}>Herunterladen</button>
              </li>)}
            </ul>}
          </div>}
        </>}
        {scheduleNotice && <p role="status">{scheduleNotice}</p>}
        {scheduleError && <div className="archive-error" role="alert">
          {scheduleError} <button type="button" disabled={scheduleLoading || savingSchedule} onClick={() => setReloadSchedule(count => count + 1)}>Erneut laden</button>
        </div>}
      </section>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="archive-error">{error}</p>}
    </div>
  );
}
