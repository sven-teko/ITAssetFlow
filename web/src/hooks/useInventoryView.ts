import { matchesPurchaseDate } from "../utils/purchaseDateFilter";
import { useEffect, useMemo, useState } from "react";

import type {
  FilterOption,
  InventoryFilterOptions,
  InventoryFilters,
} from "../components/InventorySidebar";
import type { InventoryMeta, InventoryRow } from "../types/inventory";
import { getIdentifier, getRowKey, normalizeText } from "../utils/inventory";

function emptyFilters(): InventoryFilters {
  return {
    purchaseDate: { from: "", to: "" },
    groups: new Set(),
    categories: new Set(),
    conditions: new Set(),
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

type UseInventoryViewOptions = {
  inventory: InventoryRow[];
  meta: InventoryMeta | null;
  displayedColumns: string[];
  formatValue: (column: string, value: unknown) => string;
};

export default function useInventoryView({
  inventory,
  meta,
  displayedColumns,
  formatValue,
}: UseInventoryViewOptions) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<InventoryFilters>(emptyFilters);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const filterOptions = useMemo<InventoryFilterOptions>(() => {
    const groups = new Map<string, string>();
    const categories = new Map<string, string>();
    const conditions = new Map<string, string>();

    for (const row of inventory) {
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
      sites: uniqueTextOptions(inventory, "site_name"),
      departments: uniqueTextOptions(inventory, "department_name"),
      storageLocations: uniqueTextOptions(inventory, "storage_location"),
    };
  }, [inventory, meta]);

  const filteredRows = useMemo(() => {
    const searchValue = search.trim().toLocaleLowerCase();

    return inventory.filter((row) => {
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

      if (!matchesPurchaseDate(row.purchase_date, filters.purchaseDate)) {
        return false;
      }

      if (!searchValue) {
        return true;
      }

      return displayedColumns.some((column) =>
        formatValue(column, row[column])
          .toLocaleLowerCase()
          .includes(searchValue),
      );
    });
  }, [displayedColumns, filters, formatValue, inventory, search]);

  useEffect(() => {
    const validKeys = new Set(filteredRows.map(getRowKey));
    setSelectedKeys((current) =>
      new Set([...current].filter((key) => validKeys.has(key))),
    );
  }, [filteredRows]);

  const selectedRows = useMemo(
    () => inventory.filter((row) => selectedKeys.has(getRowKey(row))),
    [inventory, selectedKeys],
  );

  const selectedIdentifiers = useMemo(
    () => selectedRows.map(getIdentifier),
    [selectedRows],
  );

  const countText =
    filteredRows.length === inventory.length
      ? `${inventory.length} Datensätze`
      : `${filteredRows.length} von ${inventory.length} Datensätzen`;

  return {
    search,
    setSearch,
    filters,
    setFilters,
    filterOptions,
    filteredRows,
    selectedKeys,
    setSelectedKeys,
    selectedRows,
    selectedIdentifiers,
    countText,
    clearSelection: () => setSelectedKeys(new Set()),
  };
}
