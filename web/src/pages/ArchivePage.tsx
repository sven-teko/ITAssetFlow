import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteArchiveEntry, loadArchive, REASON_LABELS, type ArchivedItem } from "../api/archiveApi";
import { UnauthorizedError } from "../api/inventoryApi";
import AssetDetailPanel from "../components/AssetDetailPanel";
import { DEFAULT_INVENTORY_META } from "../utils/defaultInventoryMeta";
import { getIdentifier } from "../utils/inventory";
import { formatDateTime } from "../utils/dateTime";
import "./ArchivePage.css";

export default function ArchivePage({ onSessionExpired, canDelete }: { onSessionExpired: () => void; canDelete: boolean }) {
  const navigate=useNavigate();
  const [items,setItems]=useState<ArchivedItem[]>([]);
  const [selected,setSelected]=useState<ArchivedItem | null>(null);
  const [offset,setOffset]=useState(0),[total,setTotal]=useState(0),[revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    const controller=new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const data=await loadArchive(offset,controller.signal);
        if (controller.signal.aborted) return;
        setItems(data.items); setTotal(data.total); setSelected(data.items[0]??null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof UnauthorizedError) { onSessionExpired(); return; }
        setError(cause instanceof Error ? cause.message : "Das Archiv konnte nicht geladen werden.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  },[offset,revision,onSessionExpired]);
  async function removeSelected() {
    if (!canDelete || deleting || !selected) return;
    if (!window.confirm(`„${selected.label}“ endgültig aus dem Archiv löschen? Der Eintrag kann nicht wiederhergestellt werden. Der Lagerbestand bleibt unverändert.`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteArchiveEntry(selected.id);
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - 50));
      else setRevision(value => value + 1);
    } catch (cause) {
      if (cause instanceof UnauthorizedError) onSessionExpired();
      else setDeleteError(cause instanceof Error ? cause.message : "Der Archiveintrag konnte nicht gelöscht werden.");
    } finally {
      setDeleting(false);
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
    {loading ? <p role="status">Archiv wird geladen …</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => setRevision(v=>v+1)}>Erneut laden</button></div> :
    <div className="archive-layout"><section className="archive-list" aria-label="Archivierte Artikel">
      {items.length === 0 ? <p>Keine archivierten Artikel vorhanden.</p> : <div className="archive-table-scroll"><table><thead><tr><th>Archiviert am</th><th>Artikel</th><th>Anzahl</th><th>Standort</th><th>Grund</th></tr></thead>
        <tbody>{items.map(item=><tr key={item.id} className={selected?.id===item.id?"selected":""}>
          <td>{formatDateTime(item.archived_at)}</td><td><button disabled={deleting} onClick={()=>{setSelected(item);setDeleteError("");}}>{item.label}</button></td>
          <td>{item.snapshot._record_type==="stock"?String(item.snapshot.stock_quantity??""):"1"}</td><td>{String(item.snapshot.site_name??"")}</td><td>{REASON_LABELS[item.reason]}</td>
        </tr>)}</tbody></table></div>}
      <footer><span>{total} {total===1?"Eintrag":"Einträge"}</span><button disabled={deleting || offset===0} onClick={()=>{setDeleteError("");setOffset(Math.max(0,offset-50));}}>Zurück</button>
        <button disabled={deleting || offset+50>=total} onClick={()=>{setDeleteError("");setOffset(offset+50);}}>Weiter</button></footer>
    </section>{selected && <section className="archive-detail"><div className="archive-reason-card"><h2>Archivgrund</h2>
      <p><strong>{REASON_LABELS[selected.reason]}</strong></p>
      {selected.customer_name && <p>Kunde: {selected.customer_name}</p>}
      {selected.reason==="defective" && <p>Vernichtet: {selected.destroyed?"Ja":"Nein"}</p>}
      {selected.note && <p className="archive-note">{selected.note}</p>}
      <p>Archiviert von {selected.archived_by_name}</p>
      {canDelete && <button type="button" className="archive-delete-button" disabled={deleting} onClick={() => void removeSelected()}>
        {deleting ? "Wird gelöscht …" : "Endgültig löschen"}
      </button>}
      {deleteError && <p role="alert" className="archive-delete-error">{deleteError}</p>}
      </div>
      <AssetDetailPanel rows={[selected.snapshot]} getIdentifier={getIdentifier} getHeaderLabel={column=>labels[column]??column} formatValue={format}/>
    </section>}</div>}
  </main>;
}
