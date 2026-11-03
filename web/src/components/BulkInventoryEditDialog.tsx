import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../api/config";
import type { InventoryMeta, InventoryRow } from "../types/inventory";
import { DEFAULT_INVENTORY_META } from "../utils/defaultInventoryMeta";
import "./StockWithdrawalDialog.css";
import "./BulkInventoryEditDialog.css";

type Field = "condition" | "status" | "purchase_date" | "warranty_until" | "new_price" | "note";
type Fields = Partial<Record<Field, string>>;
type Props = {
  rows: InventoryRow[];
  meta: InventoryMeta | null;
  onCancel: () => void;
  onUnauthorized: () => void;
  onSaved: (count: number) => void;
};

const fields: { key: Field; label: string; kind: "select" | "date" | "number" | "textarea" }[] = [
  { key: "condition", label: "Zustand", kind: "select" },
  { key: "status", label: "Status", kind: "select" },
  { key: "purchase_date", label: "Kaufdatum", kind: "date" },
  { key: "warranty_until", label: "Garantie bis", kind: "date" },
  { key: "new_price", label: "Neupreis (CHF)", kind: "number" },
  { key: "note", label: "Bemerkung", kind: "textarea" },
];

const assetStatuses = new Set(["available", "in_use", "defective", "in_repair", "retired"]);

const summary = [
  ["product_model_name", "Produktmodell"], ["product_category_name", "Kategorie"],
  ["site_name", "Standort"], ["storage_location", "Lagerort"],
] as const;

function commonValue(rows: InventoryRow[], key: string): string {
  const value = (row: InventoryRow) => String(row[key] ?? "");
  const first = rows[0] ? value(rows[0]) : "";
  return rows.every(row => value(row) === first) ? first : "";
}

export default function BulkInventoryEditDialog({ rows, meta, onCancel, onUnauthorized, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Fields>({});
  const includesStock = rows.some(row => row._record_type === "stock");
  const metadata = meta ?? DEFAULT_INVENTORY_META;
  const editable = includesStock ? fields.slice(0, 1) : fields;
  const changes = Object.fromEntries(editable.flatMap(({ key }) =>
    draft[key] !== undefined && draft[key] !== commonValue(rows, key) ? [[key, draft[key] || null]] : [],
  ));

  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (running.current || !Object.keys(changes).length) return;
    if (!window.confirm(`Wirklich auf alle anwenden?\n\nDie Änderungen betreffen ${rows.length} ausgewählte Einträge.`)) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const entries = rows.map(row => row._record_type === "stock" ? {
        type: "stock", product_model_id: Number(row.product_model_id), storage_location_id: Number(row.storage_location_id),
        condition: row.condition, quantity: Number(row.stock_quantity),
      } : { type: "asset", id: Number(row.id), updated_at: row.updated_at ?? null });
      const response = await fetch(`${API_BASE}/api/inventory/bulk`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries, changes }),
      });
      if (response.status === 401) { onUnauthorized(); return; }
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.updated_count !== "number") {
        throw new Error(typeof result?.detail === "string" ? result.detail : result?.detail?.message
          ?? "Die Änderungen konnten nicht gespeichert werden. Bitte das Inventar neu laden.");
      }
      onSaved(result.updated_count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Änderungen konnten nicht gespeichert werden.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return createPortal(
    <dialog ref={ref} className="stock-withdrawal bulk-inventory-dialog" aria-labelledby="bulk-edit-title"
      onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
      <form onSubmit={event => void save(event)}>
        <header>
          <h2 id="bulk-edit-title">Auswahl bearbeiten</h2>
          <p>{rows.length} Einträge ausgewählt. Übernommen werden nur geänderte Felder.</p>
        </header>
        <dl className="bulk-inventory-summary">
          {summary.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{commonValue(rows, key)}</dd></div>)}
        </dl>
        <fieldset disabled={busy}>
          {editable.map(({ key, label, kind }) => {
            const value = draft[key] ?? commonValue(rows, key);
            const change = (next: string) => setDraft(current => ({ ...current, [key]: next }));
            const options = key === "condition"
              ? { ...DEFAULT_INVENTORY_META.condition_labels, ...metadata.condition_labels }
              : { ...DEFAULT_INVENTORY_META.status_labels, ...metadata.status_labels };
            return <label key={key}>{label}
              {kind === "select" ? <select aria-label={label} value={value} onChange={event => change(event.target.value)}>
                <option value="" disabled={Boolean(commonValue(rows, key))}> </option>
                {Object.entries(options).filter(([id]) => key !== "status" || assetStatuses.has(id)).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select> : kind === "textarea" ? <textarea aria-label={label} maxLength={2000} value={value} onChange={event => change(event.target.value)}/>
                : <input aria-label={label} type={kind} value={value} onChange={event => change(event.target.value)}
                  min={kind === "number" ? 0 : undefined} step={kind === "number" ? "0.01" : undefined}
                  required={Object.hasOwn(changes, key) && (key === "purchase_date" || key === "new_price")}/>}
            </label>;
          })}
        </fieldset>
        {includesStock && <p>Bei einer Auswahl mit Mengenartikeln ist der Zustand gemeinsam änderbar.</p>}
        {error && <p role="alert" className="archive-error">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onCancel}>Abbrechen</button>
          <button type="submit" className="primary-button" disabled={busy || !Object.keys(changes).length}>
            {busy ? "Wird gespeichert …" : "Änderungen übernehmen"}
          </button>
        </footer>
      </form>
    </dialog>, document.body,
  );
}
