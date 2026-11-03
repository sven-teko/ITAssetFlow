import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ArchiveReason } from "../api/archiveApi";
import ArchiveReasonFields from "./ArchiveReasonFields";
import "./ArchiveReasonDialog.css";
export default function ArchiveReasonDialog({ count, busy, error, onCancel, onConfirm }: {
  count: number; busy: boolean; error: string; onCancel: () => void; onConfirm: (reason: ArchiveReason) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [details,setDetails]=useState<ArchiveReason>({reason:"customer",customer_name:null,destroyed:null,note:null});
  useEffect(() => { const element=dialog.current; element?.showModal(); return () => element?.close(); }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onConfirm({...details,customer_name:details.customer_name?.trim()||null,note:details.note?.trim()||null});
  }
  return <dialog ref={dialog} className="archive-reason-dialog" aria-labelledby="archive-reason-title"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <form onSubmit={submit}><h2 id="archive-reason-title">{count === 1 ? "Artikel archivieren" : `${count} Artikel archivieren`}</h2>
      <p>Die ausgewählten Einträge werden aus dem Inventar entfernt und im Archiv aufbewahrt.</p>
      <fieldset disabled={busy}><ArchiveReasonFields value={details} onChange={setDetails}/>
      </fieldset>{error && <p role="alert" className="archive-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onCancel}>Abbrechen</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Wird archiviert …" : "Archivieren"}</button></footer>
    </form></dialog>;
}
