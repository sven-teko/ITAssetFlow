import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { InventoryMeta } from "../types/inventory";
import { normalizeText } from "../utils/inventory";
import { cachedColumnPreferences, loadColumnPreferences, saveColumnPreferences } from "../api/columnPreferences";
import type { ColumnPreferences } from "../api/columnPreferences";
import { formatDateTime } from "../utils/dateTime";

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
  meta: InventoryMeta | null;
  onStatus: (text: string) => void;
};

export default function useInventoryColumns({
  email,
  meta,
  onStatus,
}: UseInventoryColumnsOptions) {
  const [preferences, setPreferences] = useState<ColumnPreferences | null>(() => cachedColumnPreferences(email));
  const revision = useRef(0);
  const ready = meta !== null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const startedAt = revision.current;
    void loadColumnPreferences(email).then(saved => {
      if (!cancelled && revision.current === startedAt && saved) setPreferences(saved);
    }).catch(error => {
      if (!cancelled) onStatus(error instanceof Error ? error.message : "Spalteneinstellungen konnten nicht geladen werden.");
    });
    return () => { cancelled = true; };
  }, [email, ready, onStatus]);

  const persist = useCallback((next: ColumnPreferences): void => {
    revision.current += 1;
    setPreferences(next);
    void saveColumnPreferences(email, next).catch(error => {
      onStatus(error instanceof Error ? error.message : "Spalteneinstellungen konnten nicht gespeichert werden.");
    });
  }, [email, onStatus]);

  const availableColumns = useMemo(() => {
    if (!meta) return [];
    const available = meta.column_order;
    const columnOrder = preferences?.column_order ?? [];
    return [
      ...columnOrder.filter((column) => available.includes(column)),
      ...available.filter((column) => !columnOrder.includes(column)),
    ];
  }, [preferences, meta]);

  const visibleColumns = useMemo(() => {
    const selected = new Set((preferences?.visible_columns ?? []).filter((column) => availableColumns.includes(column)));
    return selected.size > 0 ? selected : new Set(configuredDefaultColumns(
      email, availableColumns, meta?.default_visible_columns ?? [],
    ));
  }, [availableColumns, email, meta, preferences]);

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

      if (column === "created_at" || column === "updated_at" || column === "archived_at") return formatDateTime(value);

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
    persist({ column_order: next, visible_columns: [...visibleColumns] });
  }, [availableColumns, visibleColumns, persist]);

  const setColumnVisible = useCallback((column: string, visible: boolean): void => {
    if (!visible && visibleColumns.size <= 1) {
      onStatus("Mindestens eine Spalte muss sichtbar bleiben.");
      return;
    }
    const next = new Set(visibleColumns);
    if (visible) next.add(column);
    else next.delete(column);
    persist({ column_order: availableColumns, visible_columns: [...next] });
  }, [onStatus, visibleColumns, availableColumns, persist]);

  const showAllColumns = useCallback((): void => {
    persist({ column_order: availableColumns, visible_columns: availableColumns });
  }, [availableColumns, persist]);

  const resetColumns = useCallback((): void => {
    if (!meta) {
      return;
    }

    persist({ column_order: availableColumns, visible_columns: configuredDefaultColumns(email, availableColumns, meta.default_visible_columns) });
  }, [availableColumns, email, meta, persist]);

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
