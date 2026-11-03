import type { ArchiveReason } from "../api/archiveApi";
export default function ArchiveReasonFields({ value, onChange }: { value: ArchiveReason; onChange: (reason: ArchiveReason) => void }) {
  const change = (patch: Partial<ArchiveReason>) => onChange({ ...value, ...patch });
  return <>
    <label>Grund *<select aria-label="Grund *" value={value.reason} onChange={e=>change({reason:e.target.value as ArchiveReason["reason"],customer_name:null,destroyed:null})}>
      <option value="customer">Bei Kunde</option><option value="defective">Defekt</option><option value="retired">Ausgemustert</option><option value="lost">Verloren</option><option value="other">Anderer Grund</option>
    </select></label>
    {value.reason==="customer" && <label>Kundenname *<input required maxLength={200} value={value.customer_name??""} onChange={e=>change({customer_name:e.target.value})}/></label>}
    {value.reason==="defective" && <label>Wurde der Artikel vernichtet? *<select aria-label="Wurde der Artikel vernichtet? *" required value={value.destroyed===null?"":value.destroyed?"yes":"no"} onChange={e=>change({destroyed:e.target.value===""?null:e.target.value==="yes"})}>
      <option value="">Bitte auswählen</option><option value="yes">Ja</option><option value="no">Nein</option>
    </select></label>}
    <label>{value.reason==="other"?"Eigener Löschgrund *":"Bemerkung"}<textarea rows={3} required={value.reason==="other"} maxLength={2000} value={value.note??""} onChange={e=>change({note:e.target.value})}/></label>
  </>;
}
