import { priceRange } from "../utils/price";
import { matchesPurchaseDate, purchaseDateRange } from "../utils/purchaseDateFilter";
import { useMemo, useState } from "react";

import type {
  FilterOption,
  InventoryFilterOptions,
  InventoryFilters,
} from "../components/InventorySidebar";
import type { InventoryMeta, InventoryRow } from "../types/inventory";
import type { InventorySort } from "../components/InventoryTable";
import type { InventoryPageResult } from "../api/inventoryApi";
import { DEFAULT_INVENTORY_META } from "../utils/defaultInventoryMeta";
import { normalizeMac } from "../utils/scannerCodes";
import { getIdentifier, getRowKey, normalizeText } from "../utils/inventory";

function emptyFilters(): InventoryFilters {
  return {
    purchaseDate: "",
    newPrice: "",
    groups: new Set(),
    categories: new Set(),
    conditions: new Set(),
    statuses: new Set(),
    sites: new Set(),
    departments: new Set(),
    storageLocations: new Set(),
  };
}

function uniqueTextOptions(rows: InventoryRow[], field: string): FilterOption[] {
  const values = new Map<string, string>();

  for (const row of rows) {
    const raw = row[field];
    if (raw === null || raw === undefined) {
      continue;
    }

    const label = String(raw).trim();
    if (label) {
      values.set(label.toLocaleLowerCase(), label);
    }
  }

  return [...values.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) =>
      left.label.localeCompare(right.label, "de-CH", { sensitivity: "base" }),
    );
}

function mapOptions(values: Map<string, string>): FilterOption[] {
  return [...values.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) =>
      left.label.localeCompare(right.label, "de-CH", { sensitivity: "base" }),
    );
}

export function useInventoryCriteria(sort: InventorySort) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<InventoryFilters>(emptyFilters);
  const date = useMemo(() => purchaseDateRange(filters.purchaseDate), [filters.purchaseDate]);
  const price = useMemo(() => priceRange(filters.newPrice), [filters.newPrice]);
  const query = useMemo(() => {
    const facets = Object.entries(filters).flatMap(([key, values]) =>
      values instanceof Set ? [[key, [...values].sort()]] : [],
    );
    return JSON.stringify({
      search: search.trim().slice(0, 400), column: sort.column, sort: sort.direction,
      filters: Object.fromEntries(facets),
      date_from: date.from || null, date_to: date.to || null,
      price_from: price.from, price_to: price.to,
    });
  }, [filters, search, sort.column, sort.direction, date, price]);
  return { search, setSearch, filters, setFilters, date, price, query };
}

type UseInventoryViewOptions = {
  inventory: InventoryRow[];
  page: InventoryPageResult | null;
  serverOptions: InventoryFilterOptions | null;
  criteria: ReturnType<typeof useInventoryCriteria>;
  meta: InventoryMeta | null;
  formatValue: (column: string, value: unknown) => string;
};

export default function useInventoryView({
  inventory,
  page,
  serverOptions,
  criteria,
  meta,
  formatValue,
}: UseInventoryViewOptions) {
  const { search, setSearch, filters, setFilters, date, price } = criteria;
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const legacy = page?.legacy;
  const filterOptions = useMemo<InventoryFilterOptions>(() => {
    if (serverOptions) return serverOptions;
    const groups = new Map<string, string>();
    const categories = new Map<string, string>();
    const conditions = new Map<string, string>();
    const statuses = new Map<string, string>();

    for (const row of inventory) {
      const status = normalizeText(row.status);
      if (status) statuses.set(status, meta?.status_labels[status] ?? String(row.status));
      const group = normalizeText(row._web_inventory_group);
      if (group) {
        groups.set(group, meta?.inventory_group_labels[group] ?? group);
      }

      const category = normalizeText(row._web_category_key);
      if (category) {
        categories.set(
          category,
          String(row.product_category_name ?? category),
        );
      }

      const condition = normalizeText(row._web_condition_key);
      if (condition) {
        conditions.set(condition, meta?.condition_labels[condition] ?? condition);
      }
    }

    return {
      groups: mapOptions(groups),
      categories: mapOptions(categories),
      conditions: mapOptions(conditions),
      statuses: mapOptions(statuses),
      sites: uniqueTextOptions(inventory, "site_name"),
      departments: uniqueTextOptions(inventory, "department_name"),
      storageLocations: uniqueTextOptions(inventory, "storage_location"),
    };
  }, [inventory, meta, serverOptions]);

  const filteredRows = useMemo(() => {
    if (!legacy) return inventory;
    const searchValue = search.trim().toLocaleLowerCase();
    const macQuery = normalizeMac(searchValue);
    const searchColumns = new Set([
      ...(meta?.column_order ?? DEFAULT_INVENTORY_META.column_order),
      "asset_tag", "serial_number", "mac_address", "qr_code", "ean",
      "product_model_qr_code", "product_model_ean", "product_model_sku", "product_model_part_number",
    ]);

    const { from, to } = price;
    return inventory.filter((row) => {
      if (from !== null || to !== null) {
        const amount = row.new_price == null || row.new_price === "" ? NaN : Number(row.new_price);
        if (!Number.isFinite(amount) || (from !== null && amount < from) || (to !== null && amount > to)) return false;
      }
      if (filters.statuses.size > 0 && !filters.statuses.has(normalizeText(row.status))) {
        return false;
      }
      if (
        filters.groups.size > 0
        && !filters.groups.has(normalizeText(row._web_inventory_group))
      ) {
        return false;
      }

      if (
        filters.categories.size > 0
        && !filters.categories.has(normalizeText(row._web_category_key))
      ) {
        return false;
      }

      if (
        filters.conditions.size > 0
        && !filters.conditions.has(normalizeText(row._web_condition_key))
      ) {
        return false;
      }

      if (filters.sites.size > 0 && !filters.sites.has(normalizeText(row.site_name))) {
        return false;
      }

      if (
        filters.departments.size > 0
        && !filters.departments.has(normalizeText(row.department_name))
      ) {
        return false;
      }

      if (
        filters.storageLocations.size > 0
        && !filters.storageLocations.has(normalizeText(row.storage_location))
      ) {
        return false;
      }

      if (!matchesPurchaseDate(row.purchase_date, date)) {
        return false;
      }

      if (!searchValue) {
        return true;
      }

      if (macQuery && [row.mac_address, row.asset_tag].some(value => typeof value === "string" && normalizeMac(value) === macQuery)) return true;
      for (const column of searchColumns) {
        if (formatValue(column, row[column]).toLocaleLowerCase().includes(searchValue)) return true;
      }
      return false;
    });
  }, [filters, formatValue, inventory, legacy, meta, search, date, price]);

  // Verdeckte Zeilen dürfen auch im Render unmittelbar nach einem Filterwechsel
  // nicht bearbeitet oder gelöscht werden.
  const visibleSelectedKeys = useMemo(
    () => new Set(filteredRows.map(getRowKey).filter((key) => selectedKeys.has(key))),
    [filteredRows, selectedKeys],
  );

  const selectedRows = useMemo(
    () => filteredRows.filter((row) => visibleSelectedKeys.has(getRowKey(row))),
    [filteredRows, visibleSelectedKeys],
  );

  const selectedIdentifiers = useMemo(
    () => selectedRows.map(getIdentifier),
    [selectedRows],
  );

  const total = page?.total ?? 0;
  const matched = legacy ? filteredRows.length : page?.matched ?? 0;
  const countText = !page ? "" : matched === total ? `${total} Datensätze` : `${matched} von ${total} Datensätzen`;

  return {
    search,
    setSearch: (value: string) => { setSearch(value); setSelectedKeys(new Set()); },
    filters,
    setFilters: (value: InventoryFilters) => { setFilters(value); setSelectedKeys(new Set()); },
    filterOptions,
    filteredRows,
    selectedKeys: visibleSelectedKeys,
    setSelectedKeys,
    selectedRows,
    selectedIdentifiers,
    countText,
    clearSelection: () => setSelectedKeys(new Set()),
  };
}
