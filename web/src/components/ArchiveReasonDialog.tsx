import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ArchiveReason } from "../api/archiveApi";
import "./ArchiveReasonDialog.css";
export default function ArchiveReasonDialog({ count, busy, error, onCancel, onConfirm }: {
  count: number; busy: boolean; error: string; onCancel: () => void; onConfirm: (reason: ArchiveReason) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ArchiveReason["reason"]>("customer");
  const [customer, setCustomer] = useState("");
  const [destroyed, setDestroyed] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { const element=dialog.current; element?.showModal(); return () => element?.close(); }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onConfirm({ reason, customer_name: reason === "customer" ? customer.trim() : null,
      destroyed: reason === "defective" ? destroyed === "yes" : null, note: note.trim() || null });
  }
  return <dialog ref={dialog} className="archive-reason-dialog" aria-labelledby="archive-reason-title"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <form onSubmit={submit}><h2 id="archive-reason-title">{count === 1 ? "Artikel archivieren" : `${count} Artikel archivieren`}</h2>
      <p>Die ausgewählten Einträge werden aus dem Inventar entfernt und im Archiv aufbewahrt.</p>
      <fieldset disabled={busy}><label>Grund *<select aria-label="Grund *" value={reason} onChange={event => setReason(event.target.value as ArchiveReason["reason"])}>
        <option value="customer">Bei Kunde</option><option value="defective">Defekt</option><option value="retired">Ausgemustert</option><option value="lost">Verloren</option><option value="other">Anderer Grund</option>
      </select></label>
      {reason === "customer" && <label>Kundenname *<input required maxLength={200} value={customer} onChange={event => setCustomer(event.target.value)} /></label>}
      {reason === "defective" && <label>Wurde der Artikel vernichtet? *<select aria-label="Wurde der Artikel vernichtet? *" required value={destroyed} onChange={event => setDestroyed(event.target.value)}>
        <option value="">Bitte auswählen</option><option value="yes">Ja</option><option value="no">Nein</option>
      </select></label>}
      <label>{reason === "other" ? "Eigener Löschgrund *" : "Bemerkung"}<textarea rows={3} required={reason === "other"} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} /></label>
      </fieldset>{error && <p role="alert" className="archive-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onCancel}>Abbrechen</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Wird archiviert …" : "Archivieren"}</button></footer>
    </form></dialog>;
}
