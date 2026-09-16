import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!meta) {
      return;
    }

    const available = meta.column_order.filter((column) =>
      inventory.some((row) => column in row),
    );

    setColumnOrder((current) => {
      const preserved = current.filter((column) => available.includes(column));
      const missing = available.filter((column) => !preserved.includes(column));
      return [...preserved, ...missing];
    });

    setVisibleColumns((current) => {
      const preserved = new Set(
        [...current].filter((column) => available.includes(column)),
      );

      if (preserved.size > 0) {
        return preserved;
      }

      return new Set(
        configuredDefaultColumns(
          email,
          available,
          meta.default_visible_columns,
        ),
      );
    });
  }, [email, inventory, meta]);

  const availableColumns = useMemo(
    () =>
      columnOrder.filter((column) =>
        inventory.some((row) => column in row),
      ),
    [columnOrder, inventory],
  );

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
    if (source === target) {
      return;
    }

    setColumnOrder((current) => {
      const next = current.filter((column) => column !== source);
      const targetIndex = next.indexOf(target);

      if (targetIndex < 0) {
        return [...next, source];
      }

      next.splice(targetIndex, 0, source);
      return next;
    });
  }, []);

  const setColumnVisible = useCallback(
    (column: string, visible: boolean): void => {
      setVisibleColumns((current) => {
        const next = new Set(current);

        if (visible) {
          next.add(column);
          return next;
        }

        if (next.size <= 1) {
          onStatus("Mindestens eine Spalte muss sichtbar bleiben.");
          return current;
        }

        next.delete(column);
        return next;
      });
    },
    [onStatus],
  );

  const showAllColumns = useCallback((): void => {
    setVisibleColumns(new Set(availableColumns));
  }, [availableColumns]);

  const resetColumns = useCallback((): void => {
    if (!meta) {
      return;
    }

    setVisibleColumns(
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
