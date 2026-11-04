import { useCallback, useEffect, useRef, useState } from "react";
import {
  inventoryEventsUrl, loadInventoryMeta, loadInventoryRevision, loadInventoryPage,
  InventoryAccessDeniedError, InventoryMetaError, InventorySnapshotChanged, UnauthorizedError,
  type InventoryPageResult,
} from "../api/inventoryApi";
import type { InventoryMeta, InventoryRow } from "../types/inventory";
import { DEFAULT_INVENTORY_META } from "../utils/defaultInventoryMeta";

type Options = { query: string; onStatus: (text: string) => void; onUnauthorized: () => void };
type Page = InventoryPageResult & { query: string };
type Request = { controller: AbortController; query: string; first: boolean; done?: Promise<void> };
const emptyRows: InventoryRow[] = [];
const denied = (error: unknown) => error instanceof UnauthorizedError || error instanceof InventoryAccessDeniedError;
const message = (error: unknown) => error instanceof Error ? error.message : "Inventardaten konnten nicht geladen werden.";

export default function useInventoryData({ query, onStatus, onUnauthorized }: Options) {
  const [page, setPage] = useState<Page | null>(null);
  const [meta, setMeta] = useState<InventoryMeta | null>(null);
  const [busyQuery, setBusyQuery] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const current = useRef<Page | null>(null);
  const request = useRef<Request | null>(null);
  const checkingRevision = useRef(false);
  const accessRevoked = useRef(false);

  const commit = useCallback((next: Page | null) => {
    current.current = next;
    setPage(next);
  }, []);

  const denyAccess = useCallback(() => {
    if (accessRevoked.current) return;
    accessRevoked.current = true;
    request.current?.controller.abort();
    commit(null);
    setMeta(null);
    onUnauthorized();
  }, [commit, onUnauthorized]);

  const reload = useCallback((interactive: boolean, refresh = false) => {
    if (accessRevoked.current) return Promise.resolve();
    if (request.current?.first && request.current.query === query) return request.current.done ?? Promise.resolve();
    request.current?.controller.abort();
    const controller = new AbortController();
    const signal = controller.signal;
    setMoreError(null);
    setLoadingMore(false);
    if (interactive) {
      setBusyQuery(query);
      setLoadError(null);
      onStatus("");
    }
    const needMeta = !current.current || (interactive && (current.current.legacy || current.current.query === query));
    const watch = <T,>(promise: Promise<T>) => promise.catch(error => {
      if (!signal.aborted && (denied(error) || current.current && error instanceof InventoryMetaError && error.status === 403)) denyAccess();
      throw error;
    });
    const done = (async () => {
      try {
        const getPage = async () => {
          try { return await loadInventoryPage(query, signal, 0, null, refresh); }
          catch (error) {
            if (!(error instanceof InventorySnapshotChanged) || signal.aborted) throw error;
            return await loadInventoryPage(query, signal, 0, null, refresh);
          }
        };
        const [result, metadata] = await Promise.allSettled([
          watch(getPage()), needMeta ? watch(loadInventoryMeta(signal)) : Promise.resolve(null),
        ]);
        if (signal.aborted || request.current?.controller !== controller) return;
        if (metadata.status === "rejected") {
          const error = metadata.reason;
          if (!(error instanceof InventoryMetaError) || !error.allowsDefaultColumns) throw error;
        }
        if (result.status === "rejected") throw result.reason;
        if (metadata.status === "rejected") {
          setMeta(previous => previous ?? DEFAULT_INVENTORY_META);
          if (interactive) onStatus("Tabellenansicht mit Standardspalten.");
        } else if (metadata.value) setMeta(metadata.value);
        commit({ ...result.value, query });
        setRefreshVersion(version => version + 1);
        setLoadError(null);
      } catch (error) {
        if (signal.aborted || request.current?.controller !== controller) return;
        if (denied(error)) denyAccess();
        else if (interactive) setLoadError(message(error));
        else console.warn("Automatische Inventarsynchronisation fehlgeschlagen:", error);
      } finally {
        if (request.current?.controller === controller) {
          request.current = null;
          setBusyQuery(null);
        }
      }
    })();
    request.current = { controller, query, first: true, done };
    return done;
  }, [commit, denyAccess, onStatus, query]);

  const loadData = useCallback(() => reload(true, true), [reload]);
  const loadMore = useCallback(async () => {
    const before = current.current;
    if (accessRevoked.current || request.current || !before || before.query !== query || before.next_offset === null) return;
    const task: Request = { controller: new AbortController(), query, first: false };
    request.current = task;
    setLoadingMore(true);
    setMoreError(null);
    let restart = false;
    try {
      const part = await loadInventoryPage(query, task.controller.signal, before.next_offset, before.snapshot);
      if (task.controller.signal.aborted || request.current !== task) return;
      if (part.snapshot !== before.snapshot || part.revision !== before.revision) throw new InventorySnapshotChanged();
      commit({ ...before, next_offset: part.next_offset, rows: [...before.rows, ...part.rows] });
    } catch (error) {
      if (task.controller.signal.aborted || request.current !== task) return;
      if (denied(error)) denyAccess();
      else if (error instanceof InventorySnapshotChanged) { commit(null); restart = true; }
      else setMoreError(message(error));
    } finally {
      if (request.current === task) {
        request.current = null;
        setLoadingMore(false);
      }
    }
    if (restart) await reload(true);
  }, [commit, denyAccess, query, reload]);

  useEffect(() => {
    const existing = current.current;
    const timer = window.setTimeout(() => {
      if (!existing?.legacy) void reload(true);
    }, existing ? 160 : 0);
    return () => {
      window.clearTimeout(timer);
      if (request.current?.query === query) {
        request.current.controller.abort();
        request.current = null;
      }
    };
  }, [query, reload]);

  useEffect(() => {
    const controller = new AbortController();
    async function checkRevision() {
      if (accessRevoked.current || request.current || checkingRevision.current || document.visibilityState !== "visible") return;
      checkingRevision.current = true;
      try {
        const revision = await loadInventoryRevision(controller.signal);
        if (!controller.signal.aborted && revision !== current.current?.revision) await reload(false);
      } catch (error) {
        if (!controller.signal.aborted) {
          if (denied(error)) denyAccess();
          else console.warn("Inventarprüfung fehlgeschlagen:", error);
        }
      } finally { checkingRevision.current = false; }
    }
    const check = () => { void checkRevision(); };
    const timer = window.setInterval(check, 5_000);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "F5") { event.preventDefault(); void loadData(); }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener("keydown", keyboard);
    const events = typeof EventSource === "undefined" ? null : new EventSource(inventoryEventsUrl(), { withCredentials: true });
    let changeTimer: number | undefined;
    let reconnecting = false;
    const schedule = () => {
      window.clearTimeout(changeTimer);
      changeTimer = window.setTimeout(() => {
        if (!request.current && document.visibilityState === "visible") void reload(false, true);
      }, 250);
    };
    events?.addEventListener("inventory-changed", schedule);
    if (events) {
      events.onerror = () => { reconnecting = true; };
      events.onopen = () => { if (reconnecting) schedule(); reconnecting = false; };
    }
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.clearTimeout(changeTimer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      window.removeEventListener("keydown", keyboard);
      events?.close();
    };
  }, [denyAccess, loadData, reload]);

  const visible = page?.legacy || page?.query === query ? page : null;
  return { inventory: visible?.rows ?? emptyRows, meta, page: visible, options: page?.options ?? null, refreshVersion,
    loading: busyQuery === query || (!visible && !loadError), loadError, loadData, loadMore, loadingMore, moreError };
}
