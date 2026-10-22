import type { InventoryMeta, InventoryRow } from "../types/inventory";
import { getIdentifier, getRowKey, normalizeText } from "../utils/inventory";

type Props = {
  rows: InventoryRow[];
  meta: InventoryMeta | null;
  selectedKeys: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  onDetails: (row: InventoryRow) => void;
};

export default function InventoryCards({ rows, meta, selectedKeys, onSelectionChange, onDetails }: Props) {
  return <div className="inventory-cards" aria-label="Inventarartikel">
    {rows.map((row) => {
      const key = getRowKey(row);
      const selected = selectedKeys.has(key);
      const stock = row._record_type === "stock";
      const status = normalizeText(row.status);
      return <article key={key} className={`inventory-card${selected ? " selected" : ""}`}>
        <label className="inventory-card-select"><input type="checkbox" checked={selected}
          aria-label={`${getIdentifier(row)} auswählen`}
          onChange={() => { const next = new Set(selectedKeys); if (selected) next.delete(key); else next.add(key); onSelectionChange(next); }} /></label>
        <button type="button" className="inventory-card-body" onClick={() => onDetails(row)}>
          <span className="inventory-card-title">{getIdentifier(row)}</span>
          <span className="inventory-card-model">{String(stock ? row.product_category_name ?? "Mengenartikel" : row.product_model_name ?? "Einzelgerät")}</span>
          <span className="inventory-card-location">{[row.site_name, row.department_name, row.storage_location].filter(Boolean).join(" · ") || "Standort nicht zugeordnet"}</span>
          <span className="inventory-card-footer"><span className={`inventory-card-status status-${status}`}>{meta?.status_labels[status] ?? String(row.status ?? "")}</span>
            <strong>{stock ? `${row.stock_quantity ?? 0} Stück` : "Einzelgerät"}</strong></span>
        </button>
      </article>;
    })}
    {rows.length === 0 && <div className="inventory-cards-empty">Keine passenden Artikel gefunden.</div>}
  </div>;
}
