import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  inventoryEventsUrl,
  loadInventoryMeta,
  loadInventoryRevision,
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

const REVISION_CHECK_INTERVAL_MS =
  5_000;


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

  const lastRevisionRef =
    useRef<number | null>(
      null,
    );

  const revisionCheckRunningRef =
    useRef(
      false,
    );


  const updateRevisionBaseline =
    useCallback(
      async (): Promise<void> => {
        if (
          revisionCheckRunningRef.current
        ) {
          return;
        }

        revisionCheckRunningRef.current =
          true;

        try {
          lastRevisionRef.current =
            await loadInventoryRevision();

        } catch (error) {
          if (
            error
            instanceof UnauthorizedError
          ) {
            onUnauthorized();
            return;
          }

          // Der Hauptdatenbestand bleibt sichtbar. Die nächste 5-Sekunden-
          // Prüfung versucht die kleine Revisionsabfrage erneut.
          console.warn(
            "Inventar-Revisionsstand konnte nicht aktualisiert werden:",
            error,
          );

        } finally {
          revisionCheckRunningRef.current =
            false;
        }
      },
      [
        onUnauthorized,
      ],
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
            // Falls während eines bereits laufenden Requests eine weitere
            // Änderung erkannt wird, reicht danach genau ein zusätzlicher
            // stiller Reload.
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

              } else {
                const rows =
                  await loadInventoryRows();

                setInventory(
                  rows,
                );
              }


              // Nach jedem erfolgreichen vollständigen Inventar-Reload den
              // aktuellen Revisionswert übernehmen. Dadurch löst dieselbe
              // Änderung beim nächsten 5-Sekunden-Check keinen zweiten,
              // unnötigen Tabellen-Reload aus.
              await updateRevisionBaseline();

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
                // bekannte Tabellenstand sichtbar. SSE, Revisionsprüfung oder
                // Tab-Rückkehr versuchen später erneut zu synchronisieren.
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
        updateRevisionBaseline,
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


  const checkRevision =
    useCallback(
      async (): Promise<void> => {
        if (
          document.visibilityState
          !== "visible"
          || revisionCheckRunningRef.current
        ) {
          return;
        }

        revisionCheckRunningRef.current =
          true;

        try {
          const currentRevision =
            await loadInventoryRevision();

          const previousRevision =
            lastRevisionRef.current;

          if (
            previousRevision
            === null
          ) {
            lastRevisionRef.current =
              currentRevision;

            return;
          }

          if (
            currentRevision
            === previousRevision
          ) {
            return;
          }

          // Vor dem Reload bereits auf die neue Revision setzen. Sollte
          // während des Reloads eine weitere Änderung erfolgen, setzt
          // executeLoad nach dem Laden den dann aktuellen Wert erneut.
          lastRevisionRef.current =
            currentRevision;

          await refreshInventory();

        } catch (error) {
          if (
            error
            instanceof UnauthorizedError
          ) {
            onUnauthorized();
            return;
          }

          console.warn(
            "5-Sekunden-Inventarprüfung fehlgeschlagen:",
            error,
          );

        } finally {
          revisionCheckRunningRef.current =
            false;
        }
      },
      [
        onUnauthorized,
        refreshInventory,
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


  // ---------------------------------------------------------
  // Datenbank-Revisionsprüfung alle 5 Sekunden
  // ---------------------------------------------------------
  //
  // Diese Prüfung erkennt auch Änderungen, die direkt in Supabase,
  // über SQL oder durch die native Anwendung vorgenommen wurden.
  // Es wird dabei NICHT die komplette Inventarliste abgefragt, sondern
  // nur genau eine kleine Revisionsnummer.
  useEffect(
    () => {
      const timer =
        window.setInterval(
          () => {
            void checkRevision();
          },
          REVISION_CHECK_INTERVAL_MS,
        );


      function visibilityChanged(): void {
        if (
          document.visibilityState
          === "visible"
        ) {
          void checkRevision();
        }
      }


      function browserOnline(): void {
        void checkRevision();
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
        window.clearInterval(
          timer,
        );

        document.removeEventListener(
          "visibilitychange",
          visibilityChanged,
        );

        window.removeEventListener(
          "online",
          browserOnline,
        );
      };
    },
    [
      checkRevision,
    ],
  );


  // ---------------------------------------------------------
  // SSE für Änderungen über die WebApp
  // ---------------------------------------------------------
  //
  // Änderungen, die über FastAPI durchgeführt werden, erscheinen dadurch
  // weiterhin praktisch sofort. Die 5-Sekunden-Revisionsprüfung ist die
  // zusätzliche Absicherung für direkte Datenbankänderungen.
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

            scheduleRefresh(
              true,
            );
          }
        };


      eventSource.onerror =
        () => {
          // EventSource reconnectet selbstständig. Es wird kein zusätzliches
          // schnelles Polling gestartet.
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
