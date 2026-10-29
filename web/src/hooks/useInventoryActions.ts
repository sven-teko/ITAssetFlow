import { useRef, useState } from "react";

import {
  deleteInventoryEntries,
  exportInventoryFile,
  importInventoryCsv,
  logoutWebSession,
  UnauthorizedError,
} from "../api/inventoryApi";
import type { ExportFormat } from "../api/inventoryApi";
import type { InventoryRow } from "../types/inventory";
import { getIdentifier, getRowKey } from "../utils/inventory";

type UseInventoryActionsOptions = {
  selectedRows: InventoryRow[];
  dataLoading: boolean;
  onStatus: (text: string) => void;
  onUnauthorized: () => void;
  onLoggedOut: () => void;
  reload: () => Promise<void>;
  clearSelection: () => void;
};

export default function useInventoryActions({
  selectedRows,
  dataLoading,
  onStatus,
  onUnauthorized,
  onLoggedOut,
  reload,
  clearSelection,
}: UseInventoryActionsOptions) {
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const transferInProgress = useRef(false);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  async function deleteEntries(rows: InventoryRow[] = selectedRows): Promise<void> {
    if (rows.length === 0 || dataLoading || deleteBusy) {
      return;
    }

    const identifiers = rows.slice(0, 8).map(getIdentifier);
    const preview = identifiers.map((identifier) => `• ${identifier}`).join("\n");
    const moreCount = Math.max(0, rows.length - identifiers.length);

    const message =
      rows.length === 1
        ? `Soll dieser Inventareintrag wirklich gelöscht werden?\n\n${preview}`
        : `Sollen diese ${rows.length} Inventareinträge wirklich gelöscht werden?\n\n`
          + preview
          + (moreCount > 0 ? `\n• … und ${moreCount} weitere` : "");

    if (!window.confirm(message)) {
      return;
    }

    setDeleteBusy(true);
    onStatus(
      rows.length === 1
        ? "Inventareintrag wird gelöscht ..."
        : `${rows.length} Inventareinträge werden gelöscht ...`,
    );

    try {
      const result = await deleteInventoryEntries(rows.map(getRowKey));
      const deletedCount = Number(result.deleted_count ?? rows.length);

      clearSelection();
      await reload();

      onStatus(
        deletedCount === 1
          ? "Inventareintrag wurde gelöscht."
          : `${deletedCount} Inventareinträge wurden gelöscht.`,
      );
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }

      onStatus(
        error instanceof Error
          ? error.message
          : "Inventareinträge konnten nicht gelöscht werden.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  function chooseCsvImport(): void {
    if (transferInProgress.current || dataLoading) {
      return;
    }

    csvFileInputRef.current?.click();
  }

  async function importCsvFile(file: File): Promise<void> {
    if (transferInProgress.current || dataLoading) return;
    const confirmed = window.confirm(
      "CSV-Import starten?\n\n"
      + `${file.name}\n\n`
      + "Vorhandene Datensätze mit denselben Primärschlüsseln werden aktualisiert.",
    );

    if (!confirmed) {
      return;
    }

    transferInProgress.current = true;
    setTransferBusy(true);
    onStatus("CSV-Datei wird importiert ...");

    try {
      const result = await importInventoryCsv(file);
      const importedRows = Number(result.imported_rows ?? 0);

      await reload();
      onStatus(`${importedRows} Datensätze wurden aus CSV importiert.`);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }

      onStatus(
        error instanceof Error ? error.message : "CSV-Import ist fehlgeschlagen.",
      );
    } finally {
      transferInProgress.current = false;
      setTransferBusy(false);
      if (csvFileInputRef.current) {
        csvFileInputRef.current.value = "";
      }
    }
  }

  async function exportFile(format: ExportFormat): Promise<void> {
    if (transferInProgress.current || dataLoading) {
      return;
    }

    transferInProgress.current = true;
    setTransferBusy(true);
    const label = format === "csv" ? "CSV" : "PostgreSQL";
    onStatus(`${label}-Export wird erstellt ...`);

    try {
      const { blob, filename } = await exportInventoryFile(format);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      onStatus(`${label}-Export wurde erstellt.`);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }

      onStatus(
        error instanceof Error ? error.message : `${label}-Export ist fehlgeschlagen.`,
      );
    } finally {
      transferInProgress.current = false;
      setTransferBusy(false);
    }
  }

  async function logout(): Promise<void> {
    try {
      await logoutWebSession();
    } finally {
      onLoggedOut();
    }
  }

  return {
    csvFileInputRef,
    deleteBusy,
    transferBusy,
    chooseCsvImport,
    importCsvFile,
    exportCsv: () => exportFile("csv"),
    exportPostgresql: () => exportFile("postgresql"),
    deleteEntries,
    logout,
  };
}
