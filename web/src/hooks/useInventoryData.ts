import { useCallback, useEffect, useState } from "react";

import {
  loadInventoryMeta,
  loadInventoryRows,
  UnauthorizedError,
} from "../api/inventoryApi";
import type { InventoryMeta, InventoryRow } from "../types/inventory";

type UseInventoryDataOptions = {
  onStatus: (text: string) => void;
  onUnauthorized: () => void;
};

export default function useInventoryData({
  onStatus,
  onUnauthorized,
}: UseInventoryDataOptions) {
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [meta, setMeta] = useState<InventoryMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    onStatus("Inventardaten werden geladen ...");

    try {
      const [rows, metadata] = await Promise.all([
        loadInventoryRows(),
        loadInventoryMeta(),
      ]);

      setInventory(rows);
      setMeta(metadata);
      onStatus(`${rows.length} Inventareinträge geladen.`);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }

      setInventory([]);
      onStatus(
        error instanceof Error
          ? error.message
          : "Inventar konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [onStatus, onUnauthorized]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent): void {
      if (event.key !== "F5") {
        return;
      }

      event.preventDefault();
      void loadData();
    }

    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [loadData]);

  return {
    inventory,
    meta,
    loading,
    loadData,
  };
}
