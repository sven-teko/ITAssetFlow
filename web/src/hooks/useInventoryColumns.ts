import { useCallback, useMemo, useState } from "react";

import type { InventoryMeta, InventoryRow } from "../types/inventory";
import { normalizeText } from "../utils/inventory";

function defaultColumnsStorageKey(email: string): string {
  return `itassetflow.default_visible_columns:${email.trim().toLocaleLowerCase()}`;
}

function configuredDefaultColumns(
  email: string,
  available: string[],
  serverDefaults: string[],
): string[] {
  try {
    const raw = localStorage.getItem(defaultColumnsStorageKey(email));

    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const selected = parsed
          .filter((value): value is string => typeof value === "string")
          .filter((column) => available.includes(column));

        if (selected.length > 0) {
          return [...new Set(selected)];
        }
      }
    }
  } catch {
    // Ungültige lokale Einstellung -> Server-Standard verwenden.
  }

  const defaults = serverDefaults.filter((column) => available.includes(column));
  return defaults.length > 0 ? defaults : available.slice(0, 5);
}

type UseInventoryColumnsOptions = {
  email: string;
  inventory: InventoryRow[];
  meta: InventoryMeta | null;
  onStatus: (text: string) => void;
};

export default function useInventoryColumns({
  email,
  inventory,
  meta,
  onStatus,
}: UseInventoryColumnsOptions) {
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [requestedVisible, setRequestedVisible] = useState<Set<string> | null>(null);

  const availableColumns = useMemo(() => {
    if (!meta) return [];
    const available = meta.column_order.filter((column) =>
      inventory.length === 0 || inventory.some((row) => column in row),
    );
    return [
      ...columnOrder.filter((column) => available.includes(column)),
      ...available.filter((column) => !columnOrder.includes(column)),
    ];
  }, [columnOrder, inventory, meta]);

  const visibleColumns = useMemo(() => {
    const selected = new Set([...requestedVisible ?? []].filter((column) => availableColumns.includes(column)));
    return selected.size > 0 ? selected : new Set(configuredDefaultColumns(
      email, availableColumns, meta?.default_visible_columns ?? [],
    ));
  }, [availableColumns, email, meta, requestedVisible]);

  const displayedColumns = useMemo(
    () => availableColumns.filter((column) => visibleColumns.has(column)),
    [availableColumns, visibleColumns],
  );

  const getHeaderLabel = useCallback(
    (column: string): string =>
      meta?.headers[column]
      ?? column.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    [meta],
  );

  const formatValue = useCallback(
    (column: string, value: unknown): string => {
      if (value === null || value === undefined) {
        return "";
      }

      if (typeof value === "boolean") {
        return value ? "Ja" : "Nein";
      }

      const normalized = typeof value === "string" ? normalizeText(value) : "";

      if (column === "status" && normalized) {
        return meta?.status_labels[normalized] ?? String(value);
      }

      if (column === "condition" && normalized) {
        return meta?.condition_labels[normalized] ?? String(value);
      }

      if (column === "stock_quantity") {
        const number = Number(value);
        if (Number.isFinite(number)) {
          return Number.isInteger(number)
            ? String(number)
            : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
        }
      }

      if (typeof value === "object") {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }

      return String(value);
    },
    [meta],
  );

  const moveColumn = useCallback((source: string, target: string): void => {
    if (source === target) return;
    const next = availableColumns.filter((column) => column !== source);
    const targetIndex = next.indexOf(target);
    if (targetIndex < 0) return;
    next.splice(targetIndex, 0, source);
    setColumnOrder(next);
  }, [availableColumns]);

  const setColumnVisible = useCallback((column: string, visible: boolean): void => {
    if (!visible && visibleColumns.size <= 1) {
      onStatus("Mindestens eine Spalte muss sichtbar bleiben.");
      return;
    }
    const next = new Set(visibleColumns);
    if (visible) next.add(column);
    else next.delete(column);
    setRequestedVisible(next);
  }, [onStatus, visibleColumns]);

  const showAllColumns = useCallback((): void => {
    setRequestedVisible(new Set(availableColumns));
  }, [availableColumns]);

  const resetColumns = useCallback((): void => {
    if (!meta) {
      return;
    }

    setRequestedVisible(
      new Set(
        configuredDefaultColumns(
          email,
          availableColumns,
          meta.default_visible_columns,
        ),
      ),
    );
  }, [availableColumns, email, meta]);

  return {
    availableColumns,
    displayedColumns,
    visibleColumns,
    getHeaderLabel,
    formatValue,
    moveColumn,
    setColumnVisible,
    showAllColumns,
    resetColumns,
  };
}
