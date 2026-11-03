import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteArchiveEntry, loadArchive, restoreArchiveEntry, REASON_LABELS, type ArchiveFilters, type ArchivedItem } from "../api/archiveApi";
import { UnauthorizedError } from "../api/inventoryApi";
import AssetDetailPanel from "../components/AssetDetailPanel";
import { DEFAULT_INVENTORY_META } from "../utils/defaultInventoryMeta";
import { getIdentifier } from "../utils/inventory";
import { formatDateTime } from "../utils/dateTime";
import "./ArchivePage.css";

const EMPTY_FILTERS: ArchiveFilters = { q: "", site: "", reason: "", date_from: "", date_until: "" };

export default function ArchivePage({ onSessionExpired, canRestore, canDelete }: { onSessionExpired: () => void; canRestore: boolean; canDelete: boolean }) {
  const navigate=useNavigate();
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [items,setItems]=useState<ArchivedItem[]>([]);
  const [selected,setSelected]=useState<ArchivedItem | null>(null);
  const [offset,setOffset]=useState(0),[total,setTotal]=useState(0),[revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [action, setAction] = useState<"restore" | "delete" | null>(null);
  const [actionError, setActionError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    const controller=new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const data=await loadArchive(offset,controller.signal,filters);
        if (controller.signal.aborted) return;
        setItems(data.items); setTotal(data.total); setSelected(data.items[0]??null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof UnauthorizedError) { onSessionExpired(); return; }
        setError(cause instanceof Error ? cause.message : "Das Archiv konnte nicht geladen werden.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  },[offset,revision,onSessionExpired,filters]);
  async function changeSelected(nextAction: "restore" | "delete") {
    const restoring = nextAction === "restore";
    if (!(restoring ? canRestore : canDelete) || action || loading || !selected) return;
    const prompt = restoring
      ? `„${selected.label}“ am ursprünglichen Lagerort wieder ins Inventar aufnehmen?`
      : `„${selected.label}“ endgültig aus dem Archiv löschen? Der Lagerbestand bleibt unverändert.`;
    if (!window.confirm(prompt)) return;
    setAction(nextAction);
    setActionError("");
    setNotice("");
    try {
      await (restoring ? restoreArchiveEntry(selected.id) : deleteArchiveEntry(selected.id));
      setNotice(restoring ? `„${selected.label}“ wurde wiederhergestellt.` : `„${selected.label}“ wurde endgültig aus dem Archiv gelöscht.`);
      setSelected(null);
      setLoading(true);
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - 50));
      else setRevision(value => value + 1);
    } catch (cause) {
      if (cause instanceof UnauthorizedError) onSessionExpired();
      else setActionError(cause instanceof Error ? cause.message : "Die Archivaktion konnte nicht ausgeführt werden.");
    } finally {
      setAction(null);
    }
  }
  const labels=DEFAULT_INVENTORY_META.headers;
  function format(column: string,value: unknown): string {
    if (["created_at","updated_at","archived_at"].includes(column)) return formatDateTime(value);
    if (value === null || value === undefined) return "";
    if (column === "status") return DEFAULT_INVENTORY_META.status_labels[String(value)]??String(value);
    if (column === "condition") return DEFAULT_INVENTORY_META.condition_labels[String(value)]??String(value);
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return <main className="archive-page">
    <header><div><h1>Archiv</h1><p>Aus dem Inventar entfernte Artikel</p></div><button onClick={() => navigate("/inventory")}>Zurück zum Inventar</button></header>
    <form className="archive-filters" aria-label="Archiv filtern" onSubmit={event => {
      event.preventDefault(); setActionError(""); setNotice(""); setOffset(0); setFilters({ ...draft });
    }}>
      <label>Artikel suchen<input type="search" value={draft.q} maxLength={160} placeholder="Name, Seriennummer, Code"
        onChange={event => setDraft({ ...draft, q: event.target.value })}/></label>
      <label>Standort<input type="search" value={draft.site} maxLength={160} placeholder="Alle Standorte"
        onChange={event => setDraft({ ...draft, site: event.target.value })}/></label>
      <label>Archivgrund<select value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })}>
        <option value="">Alle Gründe</option>{Object.entries(REASON_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <label>Von<input type="date" value={draft.date_from} max={draft.date_until || "9999-12-31"}
        onChange={event => setDraft({ ...draft, date_from: event.target.value })}/></label>
      <label>Bis<input type="date" value={draft.date_until} min={draft.date_from || undefined} max="9999-12-31"
        onChange={event => setDraft({ ...draft, date_until: event.target.value })}/></label>
      <div className="archive-filter-actions"><button type="submit" disabled={action !== null}>Filtern</button>
        <button type="button" disabled={action !== null} onClick={() => {
          setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setOffset(0); setActionError(""); setNotice("");
        }}>Zurücksetzen</button></div>
    </form>
    {notice && <p className="archive-notice" role="status">{notice}</p>}
    {loading ? <p role="status">Archiv wird geladen …</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => setRevision(v=>v+1)}>Erneut laden</button></div> :
    <div className="archive-layout"><section className="archive-list" aria-label="Archivierte Artikel" aria-busy={action !== null}>
      {selected && <div className="archive-actions">
        <p><strong>Ausgewählt:</strong> {selected.label}</p>
        {canRestore && <div className="archive-action-buttons">
          <button type="button" className="archive-restore-button" disabled={action !== null} onClick={() => void changeSelected("restore")}>
            {action === "restore" ? "Wird wiederhergestellt …" : "Wiederherstellen"}
          </button>
          {canDelete && <button type="button" className="archive-delete-button" disabled={action !== null} onClick={() => void changeSelected("delete")}>
            {action === "delete" ? "Wird gelöscht …" : "Endgültig löschen"}
          </button>}
        </div>}
        {actionError && <p role="alert" className="archive-delete-error">{actionError}</p>}
      </div>}
      {items.length === 0 ? <p>{Object.values(filters).some(Boolean) ? "Keine Treffer für diese Filter." : "Keine archivierten Artikel vorhanden."}</p> : <div className="archive-table-scroll"><table><thead><tr><th>Archiviert am</th><th>Artikel</th><th>Anzahl</th><th>Standort</th><th>Grund</th></tr></thead>
        <tbody>{items.map(item=><tr key={item.id} className={selected?.id===item.id?"selected":""}
          onClick={() => { if (!action) { setSelected(item); setActionError(""); } }}>
          <td>{formatDateTime(item.archived_at)}</td><td><button type="button" aria-pressed={selected?.id===item.id} disabled={action !== null}>{item.label}</button></td>
          <td>{item.snapshot._record_type==="stock"?String(item.snapshot.stock_quantity??""):"1"}</td><td>{String(item.snapshot.site_name??"")}</td><td>{REASON_LABELS[item.reason]}</td>
        </tr>)}</tbody></table></div>}
      <footer><span>{total} {total===1?"Eintrag":"Einträge"}</span><button disabled={action !== null || offset===0} onClick={()=>{setActionError("");setOffset(Math.max(0,offset-50));}}>Zurück</button>
        <button disabled={action !== null || offset+50>=total} onClick={()=>{setActionError("");setOffset(offset+50);}}>Weiter</button></footer>
    </section>{selected && <section className="archive-detail"><div className="archive-reason-card"><h2>Archivgrund</h2>
      <p><strong>{REASON_LABELS[selected.reason]}</strong></p>
      {selected.customer_name && <p>Kunde: {selected.customer_name}</p>}
      {selected.reason==="defective" && <p>Vernichtet: {selected.destroyed?"Ja":"Nein"}</p>}
      {selected.note && <p className="archive-note">{selected.note}</p>}
      <p>Archiviert von {selected.archived_by_name}</p>
      </div>
      <AssetDetailPanel rows={[selected.snapshot._record_type === "stock" ? selected.snapshot : { ...selected.snapshot, stock_quantity: 1 }]} getIdentifier={getIdentifier} getHeaderLabel={column=>labels[column]??column} formatValue={format}/>
    </section>}</div>}
  </main>;
}
