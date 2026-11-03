import { useEffect, useState } from "react";
import { loadInventoryDashboard, UnauthorizedError, type DashboardSite } from "../api/inventoryApi";
import type { InventoryRow } from "../types/inventory";
import { formatDateTime } from "../utils/dateTime";
import LoadingIndicator from "./LoadingIndicator";
import "./InventoryDashboard.css";

const money = new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" });
const count = new Intl.NumberFormat("de-CH");
const siteNames = new Intl.Collator("de-CH", { sensitivity: "base", numeric: true });
type SortKey = "name" | "changed_at" | "known_value";
type Result = { sites: DashboardSite[] } | { error: string };

type Props = {
  // The existing inventory sync updates this reference after each refresh.
  inventory: InventoryRow[];
  onUnauthorized: () => void;
};

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="dashboard-metric">
    <dt>{label}</dt><dd className="dashboard-metric-value">{value}</dd><dd className="dashboard-metric-detail">{detail}</dd>
  </div>;
}

export default function InventoryDashboard({ inventory, onUnauthorized }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [retry, setRetry] = useState(0);
  const [sort, setSort] = useState({ key: "name" as SortKey, descending: false });
  useEffect(() => {
    const controller = new AbortController();
    void loadInventoryDashboard(controller.signal).then(sites => {
      if (!controller.signal.aborted) setResult({ sites });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof UnauthorizedError) onUnauthorized();
      else setResult({ error: error instanceof Error ? error.message : "Das Dashboard konnte nicht geladen werden." });
    });
    return () => controller.abort();
  }, [inventory, onUnauthorized, retry]);

  if (result === null) return <LoadingIndicator label="Dashboard wird geladen …" />;
  if ("error" in result) return <div className="inventory-load-error" role="alert">
    <span>{result.error}</span>
    <button type="button" onClick={() => { setResult(null); setRetry(value => value + 1); }}>Erneut laden</button>
  </div>;

  const { sites } = result;
  if (!sites.length) return <p className="dashboard-empty">Keine freigegebenen Standorte oder Inventareinträge vorhanden.</p>;

  const total = sites.reduce((sum, site) => ({
    value: sum.value + site.known_value,
    missing: sum.missing + site.missing_prices,
    assets: sum.assets + site.assets,
    inUse: sum.inUse + site.in_use,
    positions: sum.positions + site.stock_positions,
    attention: sum.attention + site.attention,
    thresholds: sum.thresholds + site.configured_thresholds,
    lowStock: sum.lowStock + site.low_stock,
  }), { value: 0, missing: 0, assets: 0, inUse: 0, positions: 0, attention: 0, thresholds: 0, lowStock: 0 });
  const rows = [...sites].sort((a, b) => {
    if ((a.site_id === null) !== (b.site_id === null)) return a.site_id === null ? 1 : -1;
    if (sort.key === "changed_at" && Boolean(a.changed_at) !== Boolean(b.changed_at)) return a.changed_at ? -1 : 1;
    const order = sort.key === "known_value" ? a.known_value - b.known_value
      : sort.key === "changed_at" ? Date.parse(a.changed_at ?? "") - Date.parse(b.changed_at ?? "")
        : siteNames.compare(a.name, b.name);
    return order * (sort.descending ? -1 : 1) || siteNames.compare(a.name, b.name);
  });
  function sortHeader(key: SortKey, label: string) {
    const current = sort.key === key;
    return <th scope="col" aria-sort={current ? (sort.descending ? "descending" : "ascending") : undefined}>
      <button type="button" onClick={() => setSort(previous => ({
        key, descending: previous.key === key ? !previous.descending : key !== "name",
      }))}>
        {label}<span aria-hidden="true">{current ? (sort.descending ? " ↓" : " ↑") : " ↕"}</span>
      </button>
    </th>;
  }

  return <div className="dashboard-content">
    <dl className="dashboard-metrics" aria-label="Inventar auf einen Blick">
      <Metric label="Bekannter Neuwert" value={money.format(total.value)}
        detail={total.missing ? `${count.format(total.missing)} Positionen ohne Preis` : "Erfasste Neupreise"} />
      <Metric label="Einzelartikel" value={count.format(total.assets)} detail={`${count.format(total.inUse)} im Einsatz`} />
      <Metric label="Mengenpositionen" value={count.format(total.positions)} detail="Je Modell, Lagerort und Zustand" />
      <Metric label="Defekt / in Reparatur" value={count.format(total.attention)}
        detail={total.thresholds ? `${count.format(total.lowStock)} unter Mindestbestand` : "Einzelartikel und Mengenpositionen"} />
    </dl>
    <section className="dashboard-sites" aria-labelledby="dashboard-sites-title">
      <header>
        <h2 id="dashboard-sites-title">Standortübersicht</h2>
        <p>Die letzte Änderung zeigt eine erfasste Inventaraktivität, etwa eine Lagerbuchung, Umlagerung oder Archivierung.</p>
      </header>
      <div className="dashboard-table-scroll" tabIndex={0} role="region" aria-labelledby="dashboard-sites-title">
        <table className="dashboard-table" aria-labelledby="dashboard-sites-title">
          <thead><tr>
            {sortHeader("name", "Standort")}
            {sortHeader("changed_at", "Letzte Änderung")}
            {sortHeader("known_value", "Bekannter Neuwert")}
            <th scope="col">Einzelartikel</th>
            <th scope="col">Mengenpositionen</th>
            <th scope="col">Defekt / Reparatur</th>
            {total.thresholds > 0 && <th scope="col">Unter Mindestbestand</th>}
          </tr></thead>
          <tbody>{rows.map(site => <tr key={site.site_id ?? "unassigned"}>
            <th scope="row">{site.name}</th>
            <td>{site.changed_at ? <time dateTime={site.changed_at}>{formatDateTime(site.changed_at)}</time> : <span className="dashboard-muted">Keine erfasst</span>}</td>
            <td>{money.format(site.known_value)}
              {site.missing_prices > 0 && <small>{count.format(site.missing_prices)} ohne Preis</small>}
            </td>
            <td>{count.format(site.assets)}</td>
            <td>{count.format(site.stock_positions)}</td>
            <td><span className={site.attention ? "dashboard-attention" : undefined}>{count.format(site.attention)}</span></td>
            {total.thresholds > 0 && <td>
              {site.configured_thresholds ? <span className={site.low_stock ? "dashboard-attention" : undefined}>{count.format(site.low_stock)}</span>
                : <span className="dashboard-muted" title="Kein Mindestbestand hinterlegt">–</span>}
            </td>}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="dashboard-value-note">Einzelartikel zum erfassten Neupreis; Mengenbestände zur letzten erfassten Preisangabe je Einheit.</p>
    </section>
  </div>;
}
