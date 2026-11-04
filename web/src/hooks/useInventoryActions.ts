import { useRef, useState } from "react";

import {
  deleteInventoryEntries,
  exportInventoryFile,
  exportLabels,
  importInventoryCsv,
  logoutWebSession,
  UnauthorizedError,
} from "../api/inventoryApi";
import type { ExportFormat } from "../api/inventoryApi";
import type { ArchiveReason } from "../api/archiveApi";
import type { InventoryRow } from "../types/inventory";
import { getRowKey } from "../utils/inventory";

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
  const [archiveKeys, setArchiveKeys] = useState<string[] | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const transferInProgress = useRef(false);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  function archiveEntries(keys: string[]) {
    if (keys.length === 0 || deleteBusy) return;
    setArchiveError("");
    setArchiveKeys(keys);
  }

  function deleteEntries(rows: InventoryRow[] = selectedRows): void {
    if (!dataLoading) archiveEntries(rows.map(getRowKey));
  }

  async function confirmArchive(reason: ArchiveReason): Promise<void> {
    if (!archiveKeys || deleteBusy) return;
    setDeleteBusy(true);
    setArchiveError("");
    onStatus("Artikel werden archiviert …");
    try {
      const result = await deleteInventoryEntries(archiveKeys, reason);
      const count = Number(result.deleted_count ?? archiveKeys.length);
      setArchiveKeys(null);
      clearSelection();
      await reload();
      onStatus(`${count} ${count === 1 ? "Eintrag wurde" : "Einträge wurden"} archiviert.`);
    } catch (error) {
      if (error instanceof UnauthorizedError) { onUnauthorized(); return; }
      const message = error instanceof Error ? error.message : "Die Artikel konnten nicht archiviert werden.";
      setArchiveError(message);
      onStatus(message);
    } finally { setDeleteBusy(false); }
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
    if (transferInProgress.current) {
      return;
    }

    transferInProgress.current = true;
    setTransferBusy(true);
    const label = exportLabels[format];
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
    archiveKeys,
    archiveEntries,
    archiveError,
    confirmArchive,
    cancelArchive: () => { if (!deleteBusy) setArchiveKeys(null); },
    transferBusy,
    chooseCsvImport,
    importCsvFile,
    exportCsv: () => exportFile("csv"),
    exportCsvTables: () => exportFile("csv-tables"),
    exportExcel: () => exportFile("excel"),
    exportPostgresql: () => exportFile("postgresql"),
    deleteEntries,
    logout,
  };
}
