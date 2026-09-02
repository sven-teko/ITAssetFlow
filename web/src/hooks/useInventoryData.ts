import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  inventoryEventsUrl,
  loadInventoryMeta,
  loadInventoryRows,
  UnauthorizedError,
} from "../api/inventoryApi";

import type {
  InventoryMeta,
  InventoryRow,
} from "../types/inventory";


type UseInventoryDataOptions = {
  onStatus: (
    text: string,
  ) => void;

  onUnauthorized: () => void;
};


const BACKGROUND_REFRESH_DEBOUNCE_MS =
  250;


export default function useInventoryData({
  onStatus,
  onUnauthorized,
}: UseInventoryDataOptions) {
  const [
    inventory,
    setInventory,
  ] = useState<InventoryRow[]>(
    [],
  );

  const [
    meta,
    setMeta,
  ] = useState<InventoryMeta | null>(
    null,
  );

  const [
    loading,
    setLoading,
  ] = useState(
    false,
  );


  const inFlightRef =
    useRef<Promise<void> | null>(
      null,
    );

  const queuedSilentRefreshRef =
    useRef(
      false,
    );


  const executeLoad =
    useCallback(
      async (
        includeMeta: boolean,
        interactive: boolean,
      ): Promise<void> => {
        if (
          inFlightRef.current
        ) {
          if (!interactive) {
            // Falls während eines bereits laufenden Requests ein
            // Änderungsereignis eintrifft, führen wir danach genau einen
            // weiteren stillen Reload aus. So kann keine Änderung durch ein
            // ungünstiges Timing verloren gehen.
            queuedSilentRefreshRef.current =
              true;
          }

          await inFlightRef.current;
          return;
        }


        const task =
          (async (): Promise<void> => {
            if (interactive) {
              setLoading(
                true,
              );

              onStatus(
                "Inventardaten werden geladen ...",
              );
            }

            try {
              if (includeMeta) {
                const [
                  rows,
                  metadata,
                ] = await Promise.all([
                  loadInventoryRows(),
                  loadInventoryMeta(),
                ]);

                setInventory(
                  rows,
                );

                setMeta(
                  metadata,
                );

                if (interactive) {
                  onStatus(
                    `${rows.length} Inventareinträge geladen.`,
                  );
                }

                return;
              }


              const rows =
                await loadInventoryRows();

              setInventory(
                rows,
              );

            } catch (error) {
              if (
                error
                instanceof UnauthorizedError
              ) {
                onUnauthorized();
                return;
              }

              if (interactive) {
                setInventory(
                  [],
                );

                onStatus(
                  error instanceof Error
                    ? error.message
                    : "Inventar konnte nicht geladen werden.",
                );
              } else {
                // Bei einer kurzzeitigen Netzwerkstörung bleibt der zuletzt
                // bekannte Datenbestand sichtbar. Beim nächsten SSE-Ereignis,
                // Reconnect oder Tab-Wechsel wird erneut synchronisiert.
                console.warn(
                  "Automatische Inventarsynchronisation fehlgeschlagen:",
                  error,
                );
              }

            } finally {
              if (interactive) {
                setLoading(
                  false,
                );
              }
            }
          })();


        inFlightRef.current =
          task;

        try {
          await task;

        } finally {
          if (
            inFlightRef.current
            === task
          ) {
            inFlightRef.current =
              null;
          }

          if (
            queuedSilentRefreshRef.current
          ) {
            queuedSilentRefreshRef.current =
              false;

            void executeLoad(
              false,
              false,
            );
          }
        }
      },
      [
        onStatus,
        onUnauthorized,
      ],
    );


  const loadData =
    useCallback(
      (): Promise<void> =>
        executeLoad(
          true,
          true,
        ),
      [
        executeLoad,
      ],
    );


  const refreshInventory =
    useCallback(
      (): Promise<void> =>
        executeLoad(
          false,
          false,
        ),
      [
        executeLoad,
      ],
    );


  useEffect(
    () => {
      void loadData();
    },
    [
      loadData,
    ],
  );


  useEffect(
    () => {
      function keyboard(
        event: KeyboardEvent,
      ): void {
        if (
          event.key !== "F5"
        ) {
          return;
        }

        event.preventDefault();

        void loadData();
      }


      window.addEventListener(
        "keydown",
        keyboard,
      );

      return () =>
        window.removeEventListener(
          "keydown",
          keyboard,
        );
    },
    [
      loadData,
    ],
  );


  useEffect(
    () => {
      if (
        typeof EventSource
        === "undefined"
      ) {
        return;
      }


      let disposed =
        false;

      let debounceTimer:
        number
        | null =
          null;

      let reconnectPending =
        false;

      let hiddenSinceLastSync =
        false;


      function clearDebounce(): void {
        if (
          debounceTimer
          === null
        ) {
          return;
        }

        window.clearTimeout(
          debounceTimer,
        );

        debounceTimer =
          null;
      }


      function scheduleRefresh(
        immediate = false,
      ): void {
        if (disposed) {
          return;
        }

        if (
          document.visibilityState
          !== "visible"
        ) {
          // Solange der Benutzer den Tab nicht sieht, entstehen keine
          // Datenbankabfragen. Beim Zurückkehren wird genau einmal
          // synchronisiert.
          hiddenSinceLastSync =
            true;

          return;
        }


        clearDebounce();

        debounceTimer =
          window.setTimeout(
            () => {
              debounceTimer =
                null;

              void refreshInventory();
            },
            immediate
              ? 0
              : BACKGROUND_REFRESH_DEBOUNCE_MS,
          );
      }


      const eventSource =
        new EventSource(
          inventoryEventsUrl(),
          {
            withCredentials:
              true,
          },
        );


      eventSource.addEventListener(
        "inventory-changed",
        () => {
          scheduleRefresh();
        },
      );


      eventSource.onopen =
        () => {
          if (
            reconnectPending
          ) {
            reconnectPending =
              false;

            // Nach einer unterbrochenen SSE-Verbindung einmal synchronisieren.
            // Dadurch kann kein während der Unterbrechung verpasstes Ereignis
            // zu einem dauerhaft veralteten Tabellenstand führen.
            scheduleRefresh(
              true,
            );
          }
        };


      eventSource.onerror =
        () => {
          // EventSource versucht die Verbindung selbstständig erneut
          // aufzubauen. Wir starten hier bewusst kein Polling.
          reconnectPending =
            true;
        };


      function visibilityChanged(): void {
        if (
          document.visibilityState
          !== "visible"
        ) {
          hiddenSinceLastSync =
            true;
          return;
        }

        if (
          hiddenSinceLastSync
        ) {
          hiddenSinceLastSync =
            false;

          scheduleRefresh(
            true,
          );
        }
      }


      function browserOnline(): void {
        reconnectPending =
          true;

        scheduleRefresh(
          true,
        );
      }


      document.addEventListener(
        "visibilitychange",
        visibilityChanged,
      );

      window.addEventListener(
        "online",
        browserOnline,
      );


      return () => {
        disposed =
          true;

        clearDebounce();

        document.removeEventListener(
          "visibilitychange",
          visibilityChanged,
        );

        window.removeEventListener(
          "online",
          browserOnline,
        );

        eventSource.close();
      };
    },
    [
      refreshInventory,
    ],
  );


  return {
    inventory,
    meta,
    loading,
    loadData,
    refreshInventory,
  };
}
