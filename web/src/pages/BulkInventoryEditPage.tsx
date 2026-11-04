import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AssetFormLayout from "../components/AssetFormLayout";
import { API_BASE } from "../api/config";
import type { InventoryMeta, InventoryRow } from "../types/inventory";
import { DEFAULT_INVENTORY_META } from "../utils/defaultInventoryMeta";
import { formatCHF, parseCHF } from "../utils/price";

type Field = "condition" | "status" | "purchase_date" | "warranty_until" | "new_price" | "note";
type Draft = Partial<Record<Field, string>>;
type Selection = { rows: InventoryRow[]; meta: InventoryMeta | null };
const statuses = ["available", "in_use", "defective", "in_repair", "retired"] as const;
const normalize = (value: unknown) => String(value ?? "");

function commonField(rows: InventoryRow[], getValue: (row: InventoryRow) => string): string {
  const first = getValue(rows[0]);
  return rows.every(row => getValue(row) === first) ? first : "";
}

function commonValue(rows: InventoryRow[], key: string, format = normalize): string {
  return commonField(rows, row => format(row[key]));
}

function SharedField({ label, value }: { label: string; value: string }) {
  return <label className="asset-form-row">
    <span>{label}:</span><input className="asset-form-control" value={value} disabled />
  </label>;
}

export default function BulkInventoryEditPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const navigate = useNavigate();
  const selection = useLocation().state as Selection | null;
  const rows = selection?.rows;
  const errorRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>({});
  const cancel = () => navigate("/inventory", { replace: true });
  useEffect(() => {
    if (error) {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [error]);

  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 200) {
    return <div className="asset-form-page">
      <div className="asset-form-error-page">
        <h1>Auswahl bearbeiten</h1><p>Bitte im Inventar mindestens zwei Einträge auswählen.</p>
        <button type="button" onClick={cancel}>Zurück zum Inventar</button>
      </div>
    </div>;
  }

  const includesStock = rows.some(row => row._record_type === "stock");
  const allStock = rows.every(row => row._record_type === "stock");
  const conditionLabels = { ...DEFAULT_INVENTORY_META.condition_labels, ...selection?.meta?.condition_labels };
  const statusLabels = { ...DEFAULT_INVENTORY_META.status_labels, ...selection?.meta?.status_labels };
  const initial: Record<Field, string> = {
    condition: commonValue(rows, "condition"),
    status: commonValue(rows, "status"),
    purchase_date: commonValue(rows, "purchase_date"),
    warranty_until: commonValue(rows, "warranty_until"),
    new_price: commonValue(rows, "new_price", value => value == null || value === "" ? "" : formatCHF(Number(value))),
    note: commonValue(rows, "note"),
  };
  const value = (field: Field) => draft[field] ?? initial[field];
  const change = (field: Field, next: string) => setDraft(current => ({ ...current, [field]: next }));
  const dirty = (Object.keys(draft) as Field[]).filter(field => (!includesStock || field === "condition")
    && draft[field] !== initial[field]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (running.current || !rows || !dirty.length) return;
    setError("");
    const changes: Record<string, string | number | null> = {};
    try {
      for (const key of dirty) {
        const next = value(key).trim();
        if (key === "new_price") changes[key] = parseCHF(next);
        else if (key === "purchase_date" && !next) throw new Error("Bitte ein Kaufdatum angeben.");
        else changes[key] = next || null;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bitte prüfe die Eingaben.");
      return;
    }
    if (!window.confirm(`Wirklich auf alle anwenden?\n\nDie Änderungen betreffen ${rows.length} ausgewählte Einträge.`)) return;
    running.current = true;
    setBusy(true);
    try {
      const entries = rows.map(row => row._record_type === "stock" ? {
        type: "stock", product_model_id: Number(row.product_model_id), storage_location_id: Number(row.storage_location_id),
        condition: row.condition, quantity: Number(row.stock_quantity),
      } : { type: "asset", id: Number(row.id), updated_at: row.updated_at ?? null });
      const response = await fetch(`${API_BASE}/api/inventory/bulk`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries, changes }),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.updated_count !== "number") {
        throw new Error(typeof result?.detail === "string" ? result.detail : result?.detail?.message
          ?? "Die Änderungen konnten nicht gespeichert werden. Bitte das Inventar neu laden.");
      }
      navigate("/inventory", { replace: true, state: { inventoryNotice: `${result.updated_count} Einträge aktualisiert.` } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Änderungen konnten nicht gespeichert werden.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function select(field: "condition" | "status", label: string, options: [string, string][], disabled = false) {
    const id = `${fieldId}-${field}`;
    return <div className="asset-form-row">
      <label htmlFor={id}>{label}:</label>
      <select id={id} className="asset-form-control" value={value(field)} onChange={event => change(field, event.target.value)} disabled={busy || disabled}>
        <option value="" disabled></option>
        {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
    </div>;
  }

  function input(field: "purchase_date" | "warranty_until" | "new_price", label: string) {
    const date = field !== "new_price";
    return <label className="asset-form-row">
      <span>{label}:</span>
      <input className="asset-form-control" type={date ? "date" : "text"} value={value(field)}
        max={date ? "9999-12-31" : undefined} min={date ? "0001-01-01" : undefined}
        inputMode={date ? undefined : "decimal"} disabled={busy || includesStock}
        onChange={event => change(field, event.target.value)} />
    </label>;
  }

  return <AssetFormLayout title="Auswahl bearbeiten" description={`${rows.length} Einträge ausgewählt. Unterschiedliche Werte bleiben leer. Nur Änderungen werden übernommen.`}
    saving={busy} saveDisabled={!dirty.length} submitLabel="Änderungen speichern" onCancel={cancel} onSubmit={event => void save(event)}>
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className="asset-form-error-message">{error}</div>}
    {includesStock && <p className="asset-form-withdrawal-hint">Bei einer Auswahl mit Mengenartikeln kann der Zustand gemeinsam geändert werden.</p>}
    <div className="asset-form-columns">
      <div className="asset-form-column">
        <fieldset className="asset-form-group"><legend>Produktmodell</legend>
          <SharedField label="Produktmodell" value={commonValue(rows, "product_model_name")} />
          <SharedField label="Produktkategorie" value={commonValue(rows, "product_category_name")} />
          <SharedField label="Hersteller" value={commonValue(rows, "manufacturer_name")} />
        </fieldset>
        {!allStock && <fieldset className="asset-form-group"><legend>Scanner-Kennungen</legend>
          <SharedField label="QR-Code / Barcode" value={commonValue(rows, "qr_code")} />
          <SharedField label="EAN" value={commonValue(rows, "ean")} />
        </fieldset>}
        <fieldset className="asset-form-group"><legend>{allStock ? "Mengenbestand" : includesStock ? "Artikeldaten" : "Einzelartikel"}</legend>
          {!allStock && <>
            <SharedField label="Produkterkennung" value={commonValue(rows, "asset_tag")} />
            <SharedField label="Seriennummer" value={commonValue(rows, "serial_number")} />
            {input("warranty_until", "Garantie bis")}
          </>}
          {includesStock && <SharedField label="Menge [Stück]" value={allStock ? commonValue(rows, "stock_quantity") : ""} />}
          <label className="asset-form-row asset-form-row-top">
            <span>Bemerkungen:</span>
            <textarea className="asset-form-control asset-form-textarea" maxLength={2000}
              value={value("note")} disabled={busy || includesStock} onChange={event => change("note", event.target.value)} />
          </label>
        </fieldset>
      </div>
      <div className="asset-form-column">
        <fieldset className="asset-form-group"><legend>Allgemeine Angaben</legend>
          {select("status", "Status", statuses.map(key => [key, statusLabels[key] ?? key]), includesStock)}
          {input("purchase_date", "Kaufdatum")}
          {input("new_price", "Neupreis")}
        </fieldset>
        <fieldset className="asset-form-group"><legend>Zustand und Standort</legend>
          {select("condition", "Zustand", Object.entries(conditionLabels))}
          <SharedField label="Standort" value={commonValue(rows, "site_name")} />
          <SharedField label="Abteilung" value={commonValue(rows, "department_name")} />
          <SharedField label="Lagerort" value={commonValue(rows, "storage_location")} />
          {!allStock && <SharedField label="Mitarbeiter" value={commonField(rows, row => row.assigned_employee_id != null ? normalize(row.assigned_to) : "")} />}
        </fieldset>
      </div>
    </div>
  </AssetFormLayout>;
}
