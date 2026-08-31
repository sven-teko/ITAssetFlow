import { useRef, useState } from "react";

import {
  deleteInventoryEntries,
  exportInventoryCsv,
  importInventoryCsv,
  logoutWebSession,
  UnauthorizedError,
} from "../api/inventoryApi";
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
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  async function deleteEntries(): Promise<void> {
    if (selectedRows.length === 0 || dataLoading || deleteBusy) {
      return;
    }

    const identifiers = selectedRows.slice(0, 8).map(getIdentifier);
    const preview = identifiers.map((identifier) => `• ${identifier}`).join("\n");
    const moreCount = Math.max(0, selectedRows.length - identifiers.length);

    const message =
      selectedRows.length === 1
        ? `Soll dieser Inventareintrag wirklich gelöscht werden?\n\n${preview}`
        : `Sollen diese ${selectedRows.length} Inventareinträge wirklich gelöscht werden?\n\n`
          + preview
          + (moreCount > 0 ? `\n• … und ${moreCount} weitere` : "");

    if (!window.confirm(message)) {
      return;
    }

    setDeleteBusy(true);
    onStatus(
      selectedRows.length === 1
        ? "Inventareintrag wird gelöscht ..."
        : `${selectedRows.length} Inventareinträge werden gelöscht ...`,
    );

    try {
      const result = await deleteInventoryEntries(selectedRows.map(getRowKey));
      const deletedCount = Number(result.deleted_count ?? selectedRows.length);

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
    if (transferBusy || dataLoading) {
      return;
    }

    csvFileInputRef.current?.click();
  }

  async function importCsvFile(file: File): Promise<void> {
    const confirmed = window.confirm(
      "CSV-Import starten?\n\n"
      + `${file.name}\n\n`
      + "Vorhandene Datensätze mit denselben Primärschlüsseln werden aktualisiert.",
    );

    if (!confirmed) {
      return;
    }

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
      setTransferBusy(false);
      if (csvFileInputRef.current) {
        csvFileInputRef.current.value = "";
      }
    }
  }

  async function exportCsv(): Promise<void> {
    if (transferBusy || dataLoading) {
      return;
    }

    setTransferBusy(true);
    onStatus("CSV-Export wird erstellt ...");

    try {
      const { blob, filename } = await exportInventoryCsv();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);

      onStatus("CSV-Export wurde erstellt.");
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }

      onStatus(
        error instanceof Error ? error.message : "CSV-Export ist fehlgeschlagen.",
      );
    } finally {
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
    exportCsv,
    deleteEntries,
    logout,
  };
}
