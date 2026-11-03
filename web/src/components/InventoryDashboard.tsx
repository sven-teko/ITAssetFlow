import { Fragment, useEffect, useState } from "react";
import { loadInventoryDashboard, UnauthorizedError, type DashboardData, type DashboardLocationSummary } from "../api/inventoryApi";
import type { InventoryRow } from "../types/inventory";
import { formatDateTime } from "../utils/dateTime";
import LoadingIndicator from "./LoadingIndicator";
import "./InventoryDashboard.css";

const money = new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" });
const count = new Intl.NumberFormat("de-CH");
const siteNames = new Intl.Collator("de-CH", { sensitivity: "base", numeric: true });
type SortKey = "name" | "changed_at" | "known_value";
type Result = DashboardData | { error: string };
const REVIEW_PAGE_SIZE = 20;

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
  const [expandedSites, setExpandedSites] = useState<Set<string>>(() => new Set());
  const [reviewLimit, setReviewLimit] = useState(REVIEW_PAGE_SIZE);
  const [sort, setSort] = useState({ key: "name" as SortKey, descending: false });
  useEffect(() => {
    const controller = new AbortController();
    void loadInventoryDashboard(controller.signal).then(dashboard => {
      if (!controller.signal.aborted) setResult(dashboard);
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

  const { sites, review_items: reviewItems, review_after_days: reviewDays } = result;
  if (!sites.length) return <p className="dashboard-empty">Keine freigegebenen Standorte oder Inventareinträge vorhanden.</p>;

  const total = sites.reduce((sum, site) => ({
    value: sum.value + site.known_value,
    assets: sum.assets + site.assets,
    inUse: sum.inUse + site.in_use,
    positions: sum.positions + site.stock_positions,
    attention: sum.attention + site.attention,
    thresholds: sum.thresholds + site.configured_thresholds,
    lowStock: sum.lowStock + site.low_stock,
  }), { value: 0, assets: 0, inUse: 0, positions: 0, attention: 0, thresholds: 0, lowStock: 0 });
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

  function locationCells(row: DashboardLocationSummary) {
    return <>
            <td>{row.changed_at ? <time dateTime={row.changed_at}>{formatDateTime(row.changed_at)}</time> : <span className="dashboard-muted">Keine erfasst</span>}</td>
            <td className="dashboard-item-cell">{row.latest_item || <span className="dashboard-muted">–</span>}</td>
            <td>{money.format(row.known_value)}</td>
            <td>{count.format(row.assets)}</td>
            <td>{count.format(row.stock_positions)}</td>
            <td><span className={row.attention ? "dashboard-attention" : undefined}>{count.format(row.attention)}</span></td>
            {total.thresholds > 0 && <td>
              {row.configured_thresholds ? <span className={row.low_stock ? "dashboard-attention" : undefined}>{count.format(row.low_stock)}</span>
                : <span className="dashboard-muted" title="Kein Mindestbestand hinterlegt">–</span>}
            </td>}
    </>;
  }

  return <div className="dashboard-content">
    <dl className="dashboard-metrics" aria-label="Inventar auf einen Blick">
      <Metric label="Gesamtwert" value={money.format(total.value)} detail="Erfasste Neupreise" />
      <Metric label="Einzelartikel" value={count.format(total.assets)} detail={`${count.format(total.inUse)} im Einsatz`} />
      <Metric label="Mengenpositionen" value={count.format(total.positions)} detail="Je Modell, Lagerort und Zustand" />
      <Metric label="Defekt / in Reparatur" value={count.format(total.attention)}
        detail={total.thresholds ? `${count.format(total.lowStock)} unter Mindestbestand` : "Einzelartikel und Mengenpositionen"} />
    </dl>
    <section className="dashboard-sites" aria-labelledby="dashboard-sites-title">
      <header>
        <h2 id="dashboard-sites-title">Standortübersicht</h2>
      </header>
      <div className="dashboard-table-scroll" tabIndex={0} role="region" aria-labelledby="dashboard-sites-title">
        <table className="dashboard-table" aria-labelledby="dashboard-sites-title">
          <thead><tr>
            {sortHeader("name", "Standort")}
            {sortHeader("changed_at", "Letzte Änderung")}
            <th scope="col">Zuletzt geänderter Artikel</th>
            {sortHeader("known_value", "Gesamtwert")}
            <th scope="col">Einzelartikel</th>
            <th scope="col">Mengenpositionen</th>
            <th scope="col">Defekt / Reparatur</th>
            {total.thresholds > 0 && <th scope="col">Unter Mindestbestand</th>}
          </tr></thead>
          <tbody>{rows.map(site => {
            const id = site.site_id ?? "unassigned";
            const expanded = expandedSites.has(id);
            const departments = site.departments ?? [];
            return <Fragment key={id}>
              <tr>
                <th scope="row">{departments.length > 0
                  ? <button type="button" className="dashboard-site-toggle" aria-expanded={expanded}
                      onClick={() => setExpandedSites(previous => {
                        const next = new Set(previous);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        return next;
                      })}>
                      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>{site.name}
                    </button>
                  : site.name}</th>
                {locationCells(site)}
              </tr>
              {expanded && departments.map(department => <tr className="dashboard-department-row" key={department.id}>
                <th scope="row">{department.name}</th>
                {locationCells(department)}
              </tr>)}
            </Fragment>;
          })}</tbody>
        </table>
      </div>
    </section>
    <section className="dashboard-sites dashboard-review" aria-labelledby="dashboard-review-title">
      <header>
        <h2 id="dashboard-review-title">Zu prüfende Artikel <span>{count.format(reviewItems.length)}</span></h2>
        <p>Defekt, in Reparatur oder seit mindestens {reviewDays} Tagen unverändert.</p>
      </header>
      {reviewItems.length ? <>
        <div className="dashboard-table-scroll" tabIndex={0} role="region" aria-labelledby="dashboard-review-title">
          <table className="dashboard-table dashboard-review-table" aria-labelledby="dashboard-review-title">
            <thead><tr>
              <th scope="col">Artikel</th><th scope="col">Grund</th><th scope="col">Standort / Lagerort</th><th scope="col">Letzte Änderung</th>
            </tr></thead>
            <tbody>{reviewItems.slice(0, reviewLimit).map(item => <tr key={item.key}>
              <th scope="row" className="dashboard-item-cell">{item.item_name}{item.asset_tag && <small>{item.asset_tag}</small>}</th>
              <td><div className="dashboard-review-reasons">
                {item.issue && <span className="dashboard-attention">{item.issue === "in_repair" ? "In Reparatur" : "Defekt"}</span>}
                {item.stale && <span className="dashboard-stale">Lange unverändert</span>}
              </div></td>
              <td className="dashboard-item-cell">{item.site_name}{item.location_name && <small>{item.location_name}</small>}</td>
              <td>{item.changed_at ? <time dateTime={item.changed_at}>{formatDateTime(item.changed_at)}</time> : "–"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {reviewItems.length > reviewLimit && <footer>
          <button type="button" onClick={() => setReviewLimit(limit => limit + REVIEW_PAGE_SIZE)}>Weitere Artikel anzeigen</button>
        </footer>}
      </> : <p className="dashboard-review-empty">Aktuell keine Artikel zu prüfen.</p>}
    </section>
  </div>;
}
