import { useCallback, useEffect, useRef, useState } from "react";
import {
  inventoryEventsUrl, loadInventoryMeta, loadInventoryRevision, loadInventoryRows,
  InventoryAccessDeniedError, InventoryMetaError, UnauthorizedError,
} from "../api/inventoryApi";
import type { InventoryMeta, InventoryRow } from "../types/inventory";
import { DEFAULT_INVENTORY_META } from "../utils/defaultInventoryMeta";

type UseInventoryDataOptions = {
  onStatus: (text: string) => void;
  onUnauthorized: () => void;
};

const REVISION_INTERVAL = 5_000;
const CHANGE_DEBOUNCE = 250;

export default function useInventoryData({ onStatus, onUnauthorized }: UseInventoryDataOptions) {
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [meta, setMeta] = useState<InventoryMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const pendingRefresh = useRef(false);
  const lastRevision = useRef<number | null>(null);
  const checkingRevision = useRef(false);
  const hasInventory = useRef(false);
  const accessRevoked = useRef(false);

  const denyAccess = useCallback(() => {
    if (accessRevoked.current) return;
    accessRevoked.current = true;
    lastRevision.current = null;
    setInventory([]);
    setMeta(null);
    onUnauthorized();
  }, [onUnauthorized]);

  const reload = useCallback(async function reload(interactive: boolean, observedRevision?: number): Promise<void> {
    if (accessRevoked.current) return;
    if (inFlight.current) {
      if (!interactive && observedRevision === undefined) pendingRefresh.current = true;
      return inFlight.current;
    }

    const task = (async () => {
      if (interactive) {
        setLoading(true);
        setLoadError(null);
        onStatus("");
      }
      try {
        // Capture the revision before loading rows. A change during the load
        // must remain detectable, and a failed load must not advance it.
        let revision: number | null = observedRevision ?? null;
        if (revision === null) {
          try {
            revision = await loadInventoryRevision();
          } catch (error) {
            if (error instanceof UnauthorizedError || error instanceof InventoryAccessDeniedError) throw error;
            console.warn("Inventar-Änderungsstand nicht verfügbar:", error);
          }
        }
        let usedDefaults = false;
        if (interactive || !hasInventory.current) {
          const watchAccess = <T,>(request: Promise<T>) => request.catch(error => {
            if (error instanceof UnauthorizedError || error instanceof InventoryAccessDeniedError ||
              (hasInventory.current && error instanceof InventoryMetaError && error.status === 403)) denyAccess();
            throw error;
          });
          const [rowResult, metadataResult] = await Promise.allSettled([
            watchAccess(loadInventoryRows()), watchAccess(loadInventoryMeta()),
          ]);
          // A revoked session takes precedence over a simultaneous network error.
          for (const result of [rowResult, metadataResult]) {
            if (result.status === "rejected" && (result.reason instanceof UnauthorizedError ||
              result.reason instanceof InventoryAccessDeniedError ||
              (result.reason instanceof InventoryMetaError && result.reason.status === 403))) {
              throw result.reason;
            }
          }
          if (rowResult.status === "rejected") throw rowResult.reason;
          if (accessRevoked.current) return;
          if (metadataResult.status === "rejected") {
            const error = metadataResult.reason;
            if (!(error instanceof InventoryMetaError) || !error.allowsDefaultColumns) throw error;
            usedDefaults = true;
            setMeta(current => current ?? DEFAULT_INVENTORY_META);
          } else {
            setMeta(metadataResult.value);
          }
          setInventory(rowResult.value);
          if (interactive && usedDefaults) onStatus("Tabellenansicht mit Standardspalten.");
        } else {
          const rows = await loadInventoryRows();
          if (accessRevoked.current) return;
          setInventory(rows);
        }
        hasInventory.current = true;
        lastRevision.current = revision;
        setLoadError(null);
      } catch (error) {
        if (error instanceof UnauthorizedError || error instanceof InventoryAccessDeniedError ||
          (hasInventory.current && error instanceof InventoryMetaError && error.status === 403)) {
          denyAccess();
        } else if (interactive) {
          const message = error instanceof Error ? error.message : "Inventar konnte nicht geladen werden.";
          setLoadError(message);
        } else {
          console.warn("Automatische Inventarsynchronisation fehlgeschlagen:", error);
        }
      } finally {
        if (interactive) setLoading(false);
      }
    })();

    inFlight.current = task;
    try {
      await task;
    } finally {
      inFlight.current = null;
      if (pendingRefresh.current) {
        pendingRefresh.current = false;
        if (!accessRevoked.current && document.visibilityState === "visible") void reload(false);
      }
    }
  }, [denyAccess, onStatus]);

  const loadData = useCallback(() => reload(true), [reload]);

  const checkRevision = useCallback(async () => {
    if (accessRevoked.current || inFlight.current || checkingRevision.current ||
      document.visibilityState !== "visible") return;
    checkingRevision.current = true;
    try {
      const revision = await loadInventoryRevision();
      if (revision !== lastRevision.current) await reload(false, revision);
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof InventoryAccessDeniedError) denyAccess();
      else console.warn("Inventarprüfung fehlgeschlagen:", error);
    } finally {
      checkingRevision.current = false;
    }
  }, [denyAccess, reload]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const check = () => { void checkRevision(); };
    const timer = window.setInterval(check, REVISION_INTERVAL);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "F5") return;
      event.preventDefault();
      void loadData();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener("keydown", keyboard);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      window.removeEventListener("keydown", keyboard);
    };
  }, [checkRevision, loadData]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const events = new EventSource(inventoryEventsUrl(), { withCredentials: true });
    let timer: number | undefined;
    let reconnecting = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") {
        timer = window.setTimeout(() => { void reload(false); }, CHANGE_DEBOUNCE);
      }
    };
    events.addEventListener("inventory-changed", schedule);
    events.onerror = () => { reconnecting = true; };
    events.onopen = () => {
      if (reconnecting) schedule();
      reconnecting = false;
    };
    return () => {
      window.clearTimeout(timer);
      events.close();
    };
  }, [reload]);

  return { inventory, meta, loading, loadError, loadData };
}
