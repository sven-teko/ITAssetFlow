import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import AssetDetailPanel from "../components/AssetDetailPanel";

import InventorySidebar from "../components/InventorySidebar";

import type {
  FilterOption,
  InventoryFilterOptions,
  InventoryFilters,
} from "../components/InventorySidebar";

import InventoryTable from "../components/InventoryTable";

import MainMenu from "../components/MainMenu";

import type {
  DockPosition,
} from "../components/MainMenu";


const API_BASE =
  import.meta.env.VITE_API_BASE_URL
  ?? `${window.location.protocol}//${window.location.hostname}:8000`;


function defaultColumnsStorageKey(
  email: string,
): string {
  return (
    "itassetflow.default_visible_columns:"
    + email.trim().toLocaleLowerCase()
  );
}


function configuredDefaultColumns(
  email: string,
  available: string[],
  serverDefaults: string[],
): string[] {
  try {
    const raw = localStorage.getItem(
      defaultColumnsStorageKey(email),
    );

    if (raw) {
      const parsed: unknown =
        JSON.parse(raw);

      if (Array.isArray(parsed)) {
        const selected = parsed
          .filter(
            (value): value is string =>
              typeof value === "string",
          )
          .filter(
            (column) =>
              available.includes(column),
          );

        if (selected.length > 0) {
          return [
            ...new Set(selected),
          ];
        }
      }
    }
  } catch {
    // Ungültige lokale Einstellung -> Server-Standard verwenden.
  }

  const defaults = serverDefaults
    .filter(
      (column) =>
        available.includes(column),
    );

  return defaults.length > 0
    ? defaults
    : available.slice(0, 5);
}


type InventoryRow =
  Record<string, unknown>;


type InventoryMeta = {
  column_order: string[];

  default_visible_columns: string[];

  headers:
    Record<string, string>;

  status_labels:
    Record<string, string>;

  condition_labels:
    Record<string, string>;

  inventory_group_labels:
    Record<string, string>;
};


type InventoryPageProps = {
  email: string;

  onLogout: () => void;
};


type DockPanelKind =
  "navigation"
  | "detail";


type DockDropTarget =
  "left-edge"
  | "right-edge"
  | "before-navigation"
  | "after-navigation"
  | "before-detail"
  | "after-detail";


type DockDragState = {
  panel: DockPanelKind;
  target: DockDropTarget | null;
};


function emptyFilters(): InventoryFilters {
  return {
    groups: new Set(),
    categories: new Set(),
    conditions: new Set(),
    sites: new Set(),
    departments: new Set(),
    storageLocations: new Set(),
  };
}


function normalizeText(
  value: unknown,
): string {
  return String(
    value ?? "",
  )
    .trim()
    .toLocaleLowerCase();
}


function getRowKey(
  row: InventoryRow,
): string {
  const recordType =
    normalizeText(
      row._record_type
      ?? "asset",
    );


  if (
    recordType === "stock"
  ) {
    return [
      "stock",
      row.id ?? "",
      row.product_model_id ?? "",
      row.storage_location_id ?? "",
      row.condition ?? "",
    ].join(":");
  }


  return [
    "asset",
    row.id
      ?? row.asset_tag
      ?? row.serial_number
      ?? "",
  ].join(":");
}


function getIdentifier(
  row: InventoryRow,
): string {
  for (
    const field
    of [
      "asset_tag",
      "product_model_name",
      "serial_number",
      "id",
    ]
  ) {
    const value =
      row[field];

    if (
      value !== null
      && value !== undefined
      && String(value).trim()
    ) {
      return String(
        value,
      ).trim();
    }
  }

  return "Unbekannter Eintrag";
}


function uniqueTextOptions(
  rows: InventoryRow[],
  field: string,
): FilterOption[] {
  const values =
    new Map<string, string>();

  for (
    const row
    of rows
  ) {
    const raw =
      row[field];

    if (
      raw === null
      || raw === undefined
    ) {
      continue;
    }

    const label =
      String(
        raw,
      ).trim();

    if (!label) {
      continue;
    }

    values.set(
      label.toLocaleLowerCase(),
      label,
    );
  }


  return [
    ...values.entries(),
  ]
    .map(
      ([key, label]) => ({
        key,
        label,
      }),
    )
    .sort(
      (left, right) =>
        left.label.localeCompare(
          right.label,
          "de-CH",
          {
            sensitivity: "base",
          },
        ),
    );
}


export default function InventoryPage({
  email,
  onLogout,
}: InventoryPageProps) {
  const navigate =
    useNavigate();


  const [
    inventory,
    setInventory,
  ] = useState<InventoryRow[]>([]);


  const [
    meta,
    setMeta,
  ] = useState<InventoryMeta | null>(
    null,
  );


  const [
    loading,
    setLoading,
  ] = useState(false);


  const [
    status,
    setStatus,
  ] = useState(
    "Inventardaten werden geladen ...",
  );


  const [
    search,
    setSearch,
  ] = useState("");


  const [
    filters,
    setFilters,
  ] = useState<InventoryFilters>(
    emptyFilters,
  );


  const [
    selectedKeys,
    setSelectedKeys,
  ] = useState<Set<string>>(
    new Set(),
  );


  const [
    columnOrder,
    setColumnOrder,
  ] = useState<string[]>([]);


  const [
    visibleColumns,
    setVisibleColumns,
  ] = useState<Set<string>>(
    new Set(),
  );


  const [
    navigationVisible,
    setNavigationVisible,
  ] = useState(true);


  const [
    detailVisible,
    setDetailVisible,
  ] = useState(true);


  const [
    navigationPosition,
    setNavigationPosition,
  ] = useState<DockPosition>(
    "left",
  );


  const [
    detailPosition,
    setDetailPosition,
  ] = useState<DockPosition>(
    "right",
  );


  const [
    dockOrder,
    setDockOrder,
  ] = useState<DockPanelKind[]>([
    "navigation",
    "detail",
  ]);


  const [
    aboutOpen,
    setAboutOpen,
  ] = useState(false);


  const [
    dockDrag,
    setDockDrag,
  ] = useState<DockDragState | null>(
    null,
  );


  const [
    transferBusy,
    setTransferBusy,
  ] = useState(false);


  const csvFileInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );


  const workspaceRef =
    useRef<HTMLDivElement | null>(
      null,
    );


  const dockShellRefs =
    useRef<
      Record<
        DockPanelKind,
        HTMLDivElement | null
      >
    >({
      navigation: null,
      detail: null,
    });


  const dockPointerRef =
    useRef<{
      panel: DockPanelKind;
      startX: number;
      startY: number;
      dragging: boolean;
    } | null>(
      null,
    );


  const loadData =
    useCallback(
      async (): Promise<void> => {
        setLoading(
          true,
        );

        setStatus(
          "Inventardaten werden geladen ...",
        );


        try {
          const [
            inventoryResponse,
            metaResponse,
          ] = await Promise.all([
            fetch(
              `${API_BASE}/api/inventory`,
              {
                credentials: "include",
              },
            ),

            fetch(
              `${API_BASE}/api/inventory/meta`,
              {
                credentials: "include",
              },
            ),
          ]);


          if (
            inventoryResponse.status === 401
            || metaResponse.status === 401
          ) {
            onLogout();

            navigate(
              "/login",
              {
                replace: true,
              },
            );

            return;
          }


          const inventoryData: unknown =
            await inventoryResponse.json();

          const metaData: unknown =
            await metaResponse.json();


          if (
            !inventoryResponse.ok
          ) {
            let message =
              "Inventardaten konnten nicht geladen werden.";

            if (
              typeof inventoryData === "object"
              && inventoryData !== null
              && "detail" in inventoryData
            ) {
              const detail =
                (
                  inventoryData as {
                    detail?: unknown;
                  }
                ).detail;

              if (
                typeof detail === "string"
                && detail.trim()
              ) {
                message =
                  detail;
              }
            }

            throw new Error(
              message,
            );
          }


          if (
            !metaResponse.ok
          ) {
            throw new Error(
              "Tabelleninformationen konnten nicht geladen werden.",
            );
          }


          if (
            !Array.isArray(
              inventoryData,
            )
          ) {
            throw new Error(
              "Der Webserver hat keine gültige Inventarliste zurückgegeben.",
            );
          }


          const rows =
            inventoryData.filter(
              (
                row,
              ): row is InventoryRow =>
                typeof row === "object"
                && row !== null
                && !Array.isArray(row),
            );


          const metadata =
            metaData as InventoryMeta;


          setInventory(
            rows,
          );

          setMeta(
            metadata,
          );


          const available =
            metadata
              .column_order
              .filter(
                (column) =>
                  rows.some(
                    (row) =>
                      column in row,
                  ),
              );


          setColumnOrder(
            (current) => {
              const preserved =
                current.filter(
                  (column) =>
                    available.includes(
                      column,
                    ),
                );

              const missing =
                available.filter(
                  (column) =>
                    !preserved.includes(
                      column,
                    ),
                );

              return [
                ...preserved,
                ...missing,
              ];
            },
          );


          setVisibleColumns(
            (current) => {
              const preserved =
                new Set(
                  [...current]
                    .filter(
                      (column) =>
                        available.includes(
                          column,
                        ),
                    ),
                );

              if (
                preserved.size > 0
              ) {
                return preserved;
              }

              const defaults =
                configuredDefaultColumns(
                  email,
                  available,
                  metadata
                    .default_visible_columns,
                );

              return new Set(
                defaults,
              );
            },
          );


          setStatus(
            `${rows.length} Inventareinträge geladen.`,
          );

        } catch (error) {
          setInventory(
            [],
          );

          setSelectedKeys(
            new Set(),
          );

          setStatus(
            error instanceof Error
              ? error.message
              : "Inventar konnte nicht geladen werden.",
          );

        } finally {
          setLoading(
            false,
          );
        }
      },
      [
        navigate,
        onLogout,
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
          event.key === "F5"
        ) {
          event.preventDefault();

          void loadData();
        }
      }

      window.addEventListener(
        "keydown",
        keyboard,
      );

      return () => {
        window.removeEventListener(
          "keydown",
          keyboard,
        );
      };
    },
    [
      loadData,
    ],
  );


  useEffect(
    () => {
      if (!aboutOpen) {
        return;
      }

      function closeAboutWithEscape(
        event: KeyboardEvent,
      ): void {
        if (
          event.key === "Escape"
        ) {
          setAboutOpen(
            false,
          );
        }
      }

      window.addEventListener(
        "keydown",
        closeAboutWithEscape,
      );

      return () => {
        window.removeEventListener(
          "keydown",
          closeAboutWithEscape,
        );
      };
    },
    [
      aboutOpen,
    ],
  );


  useEffect(
    () => {
      function panelPosition(
        panel: DockPanelKind,
      ): DockPosition {
        return (
          panel === "navigation"
            ? navigationPosition
            : detailPosition
        );
      }


      function dockTargetAt(
        clientX: number,
        clientY: number,
        draggedPanel: DockPanelKind,
      ): DockDropTarget | null {
        const workspace =
          workspaceRef.current;

        if (!workspace) {
          return null;
        }

        const otherPanel: DockPanelKind =
          draggedPanel === "navigation"
            ? "detail"
            : "navigation";

        const otherElement =
          dockShellRefs.current[
            otherPanel
          ];


        // Befindet sich die Maus über der anderen Sidebar,
        // entscheidet deren linke/rechte Hälfte, ob davor
        // oder danach angedockt wird.
        if (otherElement) {
          const otherRect =
            otherElement.getBoundingClientRect();

          if (
            clientX >= otherRect.left
            && clientX <= otherRect.right
            && clientY >= otherRect.top
            && clientY <= otherRect.bottom
          ) {
            const before =
              clientX
              < (
                otherRect.left
                + otherRect.width / 2
              );

            return (
              before
                ? (
                  otherPanel === "navigation"
                    ? "before-navigation"
                    : "before-detail"
                )
                : (
                  otherPanel === "navigation"
                    ? "after-navigation"
                    : "after-detail"
                )
            );
          }
        }


        const rect =
          workspace.getBoundingClientRect();

        const edgeZone =
          Math.min(
            190,
            Math.max(
              110,
              rect.width * 0.18,
            ),
          );

        if (
          clientX
          >= rect.left
          && clientX
          <= rect.left + edgeZone
        ) {
          return "left-edge";
        }

        if (
          clientX
          <= rect.right
          && clientX
          >= rect.right - edgeZone
        ) {
          return "right-edge";
        }

        return null;
      }


      function setPanelPosition(
        panel: DockPanelKind,
        position: DockPosition,
      ): void {
        if (
          panel === "navigation"
        ) {
          setNavigationPosition(
            position,
          );

          setNavigationVisible(
            true,
          );

          return;
        }

        setDetailPosition(
          position,
        );

        setDetailVisible(
          true,
        );
      }


      function insertBefore(
        panel: DockPanelKind,
        reference: DockPanelKind,
      ): void {
        setDockOrder(
          (current) => {
            const next =
              current.filter(
                (item) =>
                  item !== panel,
              );

            const index =
              next.indexOf(
                reference,
              );

            if (
              index < 0
            ) {
              return [
                panel,
                ...next,
              ];
            }

            next.splice(
              index,
              0,
              panel,
            );

            return next;
          },
        );
      }


      function insertAfter(
        panel: DockPanelKind,
        reference: DockPanelKind,
      ): void {
        setDockOrder(
          (current) => {
            const next =
              current.filter(
                (item) =>
                  item !== panel,
              );

            const index =
              next.indexOf(
                reference,
              );

            if (
              index < 0
            ) {
              return [
                ...next,
                panel,
              ];
            }

            next.splice(
              index + 1,
              0,
              panel,
            );

            return next;
          },
        );
      }


      function applyDockTarget(
        panel: DockPanelKind,
        target: DockDropTarget,
      ): void {
        if (
          target === "left-edge"
        ) {
          setPanelPosition(
            panel,
            "left",
          );

          setDockOrder(
            (current) => [
              panel,
              ...current.filter(
                (item) =>
                  item !== panel,
              ),
            ],
          );

          setStatus(
            panel === "navigation"
              ? "Navigation ganz links angedockt."
              : "Detailansicht ganz links angedockt.",
          );

          return;
        }


        if (
          target === "right-edge"
        ) {
          setPanelPosition(
            panel,
            "right",
          );

          setDockOrder(
            (current) => [
              ...current.filter(
                (item) =>
                  item !== panel,
              ),
              panel,
            ],
          );

          setStatus(
            panel === "navigation"
              ? "Navigation ganz rechts angedockt."
              : "Detailansicht ganz rechts angedockt.",
          );

          return;
        }


        const reference: DockPanelKind =
          (
            target.endsWith(
              "navigation",
            )
              ? "navigation"
              : "detail"
          );

        const targetPosition =
          panelPosition(
            reference,
          );

        setPanelPosition(
          panel,
          targetPosition,
        );


        if (
          target.startsWith(
            "before-",
          )
        ) {
          insertBefore(
            panel,
            reference,
          );

          setStatus(
            panel === "navigation"
              ? (
                reference === "detail"
                  ? "Navigation vor der Detailansicht angedockt."
                  : "Navigation neu angeordnet."
              )
              : (
                reference === "navigation"
                  ? "Detailansicht vor der Navigation angedockt."
                  : "Detailansicht neu angeordnet."
              ),
          );

          return;
        }


        insertAfter(
          panel,
          reference,
        );

        setStatus(
          panel === "navigation"
            ? (
              reference === "detail"
                ? "Navigation hinter der Detailansicht angedockt."
                : "Navigation neu angeordnet."
            )
            : (
              reference === "navigation"
                ? "Detailansicht hinter der Navigation angedockt."
                : "Detailansicht neu angeordnet."
            ),
        );
      }


      function pointerMove(
        event: PointerEvent,
      ): void {
        const pending =
          dockPointerRef.current;

        if (!pending) {
          return;
        }

        if (!pending.dragging) {
          const distance =
            Math.abs(
              event.clientX
              - pending.startX,
            )
            + Math.abs(
              event.clientY
              - pending.startY,
            );

          if (
            distance < 7
          ) {
            return;
          }

          pending.dragging =
            true;

          document.body.classList.add(
            "dock-panel-dragging",
          );
        }

        event.preventDefault();

        setDockDrag({
          panel:
            pending.panel,
          target:
            dockTargetAt(
              event.clientX,
              event.clientY,
              pending.panel,
            ),
        });
      }


      function finishDockDrag(): void {
        const pending =
          dockPointerRef.current;

        if (!pending) {
          return;
        }

        dockPointerRef.current =
          null;

        document.body.classList.remove(
          "dock-panel-dragging",
        );

        setDockDrag(
          (current) => {
            if (
              pending.dragging
              && current?.target
            ) {
              applyDockTarget(
                pending.panel,
                current.target,
              );
            }

            return null;
          },
        );
      }


      window.addEventListener(
        "pointermove",
        pointerMove,
        {
          passive: false,
        },
      );

      window.addEventListener(
        "pointerup",
        finishDockDrag,
      );

      window.addEventListener(
        "pointercancel",
        finishDockDrag,
      );

      window.addEventListener(
        "blur",
        finishDockDrag,
      );


      return () => {
        window.removeEventListener(
          "pointermove",
          pointerMove,
        );

        window.removeEventListener(
          "pointerup",
          finishDockDrag,
        );

        window.removeEventListener(
          "pointercancel",
          finishDockDrag,
        );

        window.removeEventListener(
          "blur",
          finishDockDrag,
        );

        document.body.classList.remove(
          "dock-panel-dragging",
        );
      };
    },
    [
      detailPosition,
      navigationPosition,
    ],
  );


  const availableColumns =
    useMemo(
      () =>
        columnOrder.filter(
          (column) =>
            inventory.some(
              (row) =>
                column in row,
            ),
        ),
      [
        columnOrder,
        inventory,
      ],
    );


  const displayedColumns =
    useMemo(
      () =>
        availableColumns.filter(
          (column) =>
            visibleColumns.has(
              column,
            ),
        ),
      [
        availableColumns,
        visibleColumns,
      ],
    );


  function getHeaderLabel(
    column: string,
  ): string {
    return (
      meta?.headers[column]
      ?? column
        .replaceAll(
          "_",
          " ",
        )
        .replace(
          /\b\w/g,
          (letter) =>
            letter.toUpperCase(),
        )
    );
  }


  function formatValue(
    column: string,
    value: unknown,
  ): string {
    if (
      value === null
      || value === undefined
    ) {
      return "";
    }


    if (
      typeof value === "boolean"
    ) {
      return value
        ? "Ja"
        : "Nein";
    }


    const normalized =
      typeof value === "string"
        ? normalizeText(
            value,
          )
        : "";


    if (
      column === "status"
      && normalized
    ) {
      return (
        meta?.status_labels[
          normalized
        ]
        ?? String(value)
      );
    }


    if (
      column === "condition"
      && normalized
    ) {
      return (
        meta?.condition_labels[
          normalized
        ]
        ?? String(value)
      );
    }


    if (
      column === "stock_quantity"
    ) {
      const number =
        Number(value);

      if (
        Number.isFinite(
          number,
        )
      ) {
        return Number.isInteger(
          number,
        )
          ? String(number)
          : number
              .toFixed(3)
              .replace(
                /0+$/,
                "",
              )
              .replace(
                /\.$/,
                "",
              );
      }
    }


    if (
      typeof value === "object"
    ) {
      try {
        return JSON.stringify(
          value,
        );
      } catch {
        return String(
          value,
        );
      }
    }


    return String(
      value,
    );
  }


  const filterOptions =
    useMemo<InventoryFilterOptions>(
      () => {
        const groups =
          new Map<string, string>();

        const categories =
          new Map<string, string>();

        const conditions =
          new Map<string, string>();


        for (
          const row
          of inventory
        ) {
          const group =
            normalizeText(
              row._web_inventory_group,
            );

          if (group) {
            groups.set(
              group,
              meta
                ?.inventory_group_labels[
                  group
                ]
              ?? group,
            );
          }


          const category =
            normalizeText(
              row._web_category_key,
            );

          if (category) {
            categories.set(
              category,
              String(
                row.product_category_name
                ?? category,
              ),
            );
          }


          const condition =
            normalizeText(
              row._web_condition_key,
            );

          if (condition) {
            conditions.set(
              condition,
              meta?.condition_labels[
                condition
              ]
              ?? condition,
            );
          }
        }


        function mapOptions(
          values: Map<string, string>,
        ): FilterOption[] {
          return [
            ...values.entries(),
          ]
            .map(
              ([key, label]) => ({
                key,
                label,
              }),
            )
            .sort(
              (left, right) =>
                left.label.localeCompare(
                  right.label,
                  "de-CH",
                  {
                    sensitivity: "base",
                  },
                ),
            );
        }


        return {
          groups:
            mapOptions(
              groups,
            ),

          categories:
            mapOptions(
              categories,
            ),

          conditions:
            mapOptions(
              conditions,
            ),

          sites:
            uniqueTextOptions(
              inventory,
              "site_name",
            ),

          departments:
            uniqueTextOptions(
              inventory,
              "department_name",
            ),

          storageLocations:
            uniqueTextOptions(
              inventory,
              "storage_location",
            ),
        };
      },
      [
        inventory,
        meta,
      ],
    );


  const filteredRows =
    useMemo(
      () => {
        const searchValue =
          search
            .trim()
            .toLocaleLowerCase();


        return inventory.filter(
          (row) => {
            if (
              filters.groups.size > 0
              && !filters.groups.has(
                normalizeText(
                  row._web_inventory_group,
                ),
              )
            ) {
              return false;
            }


            if (
              filters.categories.size > 0
              && !filters.categories.has(
                normalizeText(
                  row._web_category_key,
                ),
              )
            ) {
              return false;
            }


            if (
              filters.conditions.size > 0
              && !filters.conditions.has(
                normalizeText(
                  row._web_condition_key,
                ),
              )
            ) {
              return false;
            }


            if (
              filters.sites.size > 0
              && !filters.sites.has(
                normalizeText(
                  row.site_name,
                ),
              )
            ) {
              return false;
            }


            if (
              filters.departments.size > 0
              && !filters.departments.has(
                normalizeText(
                  row.department_name,
                ),
              )
            ) {
              return false;
            }


            if (
              filters.storageLocations.size > 0
              && !filters.storageLocations.has(
                normalizeText(
                  row.storage_location,
                ),
              )
            ) {
              return false;
            }


            if (
              !searchValue
            ) {
              return true;
            }


            return displayedColumns.some(
              (column) =>
                formatValue(
                  column,
                  row[column],
                )
                  .toLocaleLowerCase()
                  .includes(
                    searchValue,
                  ),
            );
          },
        );
      },
      [
        inventory,
        search,
        filters,
        displayedColumns,
        meta,
      ],
    );


  useEffect(
    () => {
      const validKeys =
        new Set(
          filteredRows.map(
            getRowKey,
          ),
        );

      setSelectedKeys(
        (current) =>
          new Set(
            [...current].filter(
              (key) =>
                validKeys.has(
                  key,
                ),
            ),
          ),
      );
    },
    [
      filteredRows,
    ],
  );


  const selectedRows =
    useMemo(
      () =>
        inventory.filter(
          (row) =>
            selectedKeys.has(
              getRowKey(
                row,
              ),
            ),
        ),
      [
        inventory,
        selectedKeys,
      ],
    );


  const selectedIdentifiers =
    selectedRows.map(
      getIdentifier,
    );


  const totalCount =
    inventory.length;

  const visibleCount =
    filteredRows.length;


  const countText =
    visibleCount === totalCount
      ? `${totalCount} Datensätze`
      : `${visibleCount} von ${totalCount} Datensätzen`;


  function moveColumn(
    source: string,
    target: string,
  ): void {
    if (
      source === target
    ) {
      return;
    }


    setColumnOrder(
      (current) => {
        const next =
          current.filter(
            (column) =>
              column !== source,
          );

        const targetIndex =
          next.indexOf(
            target,
          );


        if (
          targetIndex < 0
        ) {
          return [
            ...next,
            source,
          ];
        }


        next.splice(
          targetIndex,
          0,
          source,
        );


        return next;
      },
    );
  }


  function setColumnVisible(
    column: string,
    visible: boolean,
  ): void {
    setVisibleColumns(
      (current) => {
        const next =
          new Set(
            current,
          );

        if (visible) {
          next.add(
            column,
          );

          return next;
        }


        if (
          next.size <= 1
        ) {
          setStatus(
            "Mindestens eine Spalte muss sichtbar bleiben.",
          );

          return current;
        }


        next.delete(
          column,
        );

        return next;
      },
    );
  }


  function showAllColumns(): void {
    setVisibleColumns(
      new Set(
        availableColumns,
      ),
    );
  }


  function resetColumns(): void {
    if (!meta) {
      return;
    }

    const defaults =
      configuredDefaultColumns(
        email,
        availableColumns,
        meta.default_visible_columns,
      );

    setVisibleColumns(
      new Set(
        defaults,
      ),
    );
  }


  function createEntry(): void {
    navigate(
      "/inventory/new",
    );
  }


  function editEntry(): void {
    if (
      selectedRows.length !== 1
    ) {
      return;
    }

    navigate(
      `/inventory/${encodeURIComponent(
        getRowKey(
          selectedRows[0],
        ),
      )}/edit`,
    );
  }


  async function deleteEntries(): Promise<void> {
    if (
      selectedRows.length === 0
      || loading
    ) {
      return;
    }


    const identifiers =
      selectedRows
        .slice(
          0,
          8,
        )
        .map(
          getIdentifier,
        );


    const preview =
      identifiers
        .map(
          (identifier) =>
            `• ${identifier}`,
        )
        .join(
          "\n",
        );


    const moreCount =
      Math.max(
        0,
        selectedRows.length
        - identifiers.length,
      );


    const message =
      selectedRows.length === 1
        ? (
          "Soll dieser Inventareintrag wirklich gelöscht werden?\n\n"
          + preview
        )
        : (
          `Sollen diese ${selectedRows.length} Inventareinträge `
          + "wirklich gelöscht werden?\n\n"
          + preview
          + (
            moreCount > 0
              ? `\n• … und ${moreCount} weitere`
              : ""
          )
        );


    if (
      !window.confirm(
        message,
      )
    ) {
      return;
    }


    setLoading(
      true,
    );

    setStatus(
      selectedRows.length === 1
        ? "Inventareintrag wird gelöscht ..."
        : `${selectedRows.length} Inventareinträge werden gelöscht ...`,
    );


    try {
      const response =
        await fetch(
          `${API_BASE}/api/inventory/delete`,
          {
            method: "POST",

            credentials: "include",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                entry_keys:
                  selectedRows.map(
                    getRowKey,
                  ),
              }),
          },
        );


      if (
        response.status === 401
      ) {
        onLogout();

        navigate(
          "/login",
          {
            replace: true,
          },
        );

        return;
      }


      const data: unknown =
        await response.json();


      if (!response.ok) {
        let message =
          "Inventareinträge konnten nicht gelöscht werden.";


        if (
          typeof data === "object"
          && data !== null
          && "detail" in data
        ) {
          const detail =
            (
              data as {
                detail?: unknown;
              }
            ).detail;

          if (
            typeof detail === "string"
            && detail.trim()
          ) {
            message =
              detail;
          }
        }


        throw new Error(
          message,
        );
      }


      const result =
        data as {
          deleted_count?: unknown;
          asset_count?: unknown;
          stock_count?: unknown;
        };


      const deletedCount =
        Number(
          result.deleted_count
          ?? selectedRows.length,
        );


      setSelectedKeys(
        new Set(),
      );


      await loadData();


      setStatus(
        deletedCount === 1
          ? "Inventareintrag wurde gelöscht."
          : `${deletedCount} Inventareinträge wurden gelöscht.`,
      );

    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Inventareinträge konnten nicht gelöscht werden.",
      );

    } finally {
      setLoading(
        false,
      );
    }
  }


  function chooseCsvImport(): void {
    if (
      transferBusy
      || loading
    ) {
      return;
    }


    csvFileInputRef.current
      ?.click();
  }


  async function importCsvFile(
    file: File,
  ): Promise<void> {
    const confirmed =
      window.confirm(
        "CSV-Import starten?\n\n"
        + `${file.name}\n\n`
        + "Vorhandene Datensätze mit denselben Primärschlüsseln "
        + "werden aktualisiert.",
      );


    if (!confirmed) {
      return;
    }


    setTransferBusy(
      true,
    );

    setStatus(
      "CSV-Datei wird importiert ...",
    );


    try {
      const response =
        await fetch(
          `${API_BASE}/api/transfer/import/csv`,
          {
            method: "POST",

            credentials: "include",

            headers: {
              "Content-Type":
                "text/csv",
            },

            body: file,
          },
        );


      if (
        response.status === 401
      ) {
        onLogout();

        navigate(
          "/login",
          {
            replace: true,
          },
        );

        return;
      }


      const data: unknown =
        await response.json();


      if (!response.ok) {
        let message =
          "CSV-Import ist fehlgeschlagen.";


        if (
          typeof data === "object"
          && data !== null
          && "detail" in data
        ) {
          const detail =
            (
              data as {
                detail?: unknown;
              }
            ).detail;

          if (
            typeof detail === "string"
            && detail.trim()
          ) {
            message =
              detail;
          }
        }


        throw new Error(
          message,
        );
      }


      const result =
        data as {
          imported_rows?: unknown;
          table_count?: unknown;
        };


      const importedRows =
        Number(
          result.imported_rows
          ?? 0,
        );


      await loadData();


      setStatus(
        `${importedRows} Datensätze wurden aus CSV importiert.`,
      );

    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "CSV-Import ist fehlgeschlagen.",
      );

    } finally {
      setTransferBusy(
        false,
      );

      if (
        csvFileInputRef.current
      ) {
        csvFileInputRef.current.value =
          "";
      }
    }
  }


  async function exportCsv(): Promise<void> {
    if (
      transferBusy
      || loading
    ) {
      return;
    }


    setTransferBusy(
      true,
    );

    setStatus(
      "CSV-Export wird erstellt ...",
    );


    try {
      const response =
        await fetch(
          `${API_BASE}/api/transfer/export/csv`,
          {
            method: "GET",
            credentials: "include",
          },
        );


      if (
        response.status === 401
      ) {
        onLogout();

        navigate(
          "/login",
          {
            replace: true,
          },
        );

        return;
      }


      if (!response.ok) {
        let message =
          "CSV-Export ist fehlgeschlagen.";

        try {
          const data: unknown =
            await response.json();

          if (
            typeof data === "object"
            && data !== null
            && "detail" in data
          ) {
            const detail =
              (
                data as {
                  detail?: unknown;
                }
              ).detail;

            if (
              typeof detail === "string"
              && detail.trim()
            ) {
              message =
                detail;
            }
          }
        } catch {
          // Kein JSON-Fehlertext vorhanden.
        }


        throw new Error(
          message,
        );
      }


      const blob =
        await response.blob();


      const disposition =
        response.headers.get(
          "Content-Disposition",
        )
        ?? "";


      const filenameMatch =
        /filename="?([^"]+)"?/i.exec(
          disposition,
        );


      const filename =
        filenameMatch?.[1]
        ?? "ITAssetFlow.csv";


      const objectUrl =
        URL.createObjectURL(
          blob,
        );


      const link =
        document.createElement(
          "a",
        );

      link.href =
        objectUrl;

      link.download =
        filename;

      document.body.appendChild(
        link,
      );

      link.click();

      link.remove();


      URL.revokeObjectURL(
        objectUrl,
      );


      setStatus(
        "CSV-Export wurde erstellt.",
      );

    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "CSV-Export ist fehlgeschlagen.",
      );

    } finally {
      setTransferBusy(
        false,
      );
    }
  }


  function dockPanelAtEdge(
    panel: DockPanelKind,
    position: DockPosition,
  ): void {
    if (
      panel === "navigation"
    ) {
      setNavigationPosition(
        position,
      );

      setNavigationVisible(
        true,
      );
    } else {
      setDetailPosition(
        position,
      );

      setDetailVisible(
        true,
      );
    }


    setDockOrder(
      (current) => {
        const next =
          current.filter(
            (item) =>
              item !== panel,
          );

        return (
          position === "left"
            ? [
              panel,
              ...next,
            ]
            : [
              ...next,
              panel,
            ]
        );
      },
    );
  }


  function panelPosition(
    panel: DockPanelKind,
  ): DockPosition {
    return (
      panel === "navigation"
        ? navigationPosition
        : detailPosition
    );
  }


  function panelContent(
    panel: DockPanelKind,
  ): ReactNode {
    return (
      panel === "navigation"
        ? navigationPanel
        : detailPanel
    );
  }


  function beginDockPointer(
    panel: DockPanelKind,
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (
      event.button !== 0
      || !event.isPrimary
    ) {
      return;
    }

    const target =
      event.target as HTMLElement;

    if (
      !target.closest(
        ".dock-title",
      )
    ) {
      return;
    }

    event.preventDefault();

    dockPointerRef.current = {
      panel,
      startX:
        event.clientX,
      startY:
        event.clientY,
      dragging:
        false,
    };
  }


  function dockShell(
    panel: DockPanelKind,
    content: ReactNode,
  ): ReactNode {
    if (!content) {
      return null;
    }

    const dragging =
      dockDrag?.panel
      === panel;

    return (
      <div
        ref={(element) => {
          dockShellRefs.current[
            panel
          ] = element;
        }}
        data-dock-panel={
          panel
        }
        className={[
          "dock-shell",
          panel
            === "navigation"
            ? "dock-navigation-shell"
            : "dock-detail-shell",
          dragging
            ? "dock-shell-dragging"
            : "",
          dockDrag?.target
            === `before-${panel}`
            ? "dock-shell-drop-before"
            : "",
          dockDrag?.target
            === `after-${panel}`
            ? "dock-shell-drop-after"
            : "",
        ]
          .filter(
            Boolean,
          )
          .join(
            " ",
          )}
        onPointerDown={(event) =>
          beginDockPointer(
            panel,
            event,
          )
        }
      >
        {content}
      </div>
    );
  }


  async function logout(): Promise<void> {
    try {
      await fetch(
        `${API_BASE}/api/auth/logout`,
        {
          method: "POST",
          credentials: "include",
        },
      );
    } finally {
      onLogout();

      navigate(
        "/login",
        {
          replace: true,
        },
      );
    }
  }


  const navigationPanel =
    navigationVisible
      ? (
        <InventorySidebar
          search={search}
          filters={filters}
          options={filterOptions}
          loading={loading}
          selectedIdentifiers={
            selectedIdentifiers
          }
          countText={countText}
          onSearchChange={
            setSearch
          }
          onFiltersChange={
            setFilters
          }
          onCreate={
            createEntry
          }
          onEdit={
            editEntry
          }
          onDelete={() =>
            void deleteEntries()
          }
        />
      )
      : null;


  const detailPanel =
    detailVisible
      ? (
        <AssetDetailPanel
          rows={selectedRows}
          getIdentifier={
            getIdentifier
          }
          getHeaderLabel={
            getHeaderLabel
          }
          formatValue={
            formatValue
          }
        />
      )
      : null;


  return (
    <div className="main-window">

      <input
        ref={csvFileInputRef}
        className="hidden-file-input"
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => {
          const file =
            event.target.files?.[0];

          if (file) {
            void importCsvFile(
              file,
            );
          }
        }}
      />


      <MainMenu
        navigationVisible={
          navigationVisible
        }
        detailVisible={
          detailVisible
        }
        navigationPosition={
          navigationPosition
        }
        detailPosition={
          detailPosition
        }
        columns={
          availableColumns
        }
        visibleColumns={
          visibleColumns
        }
        transferBusy={
          transferBusy
        }
        getHeaderLabel={
          getHeaderLabel
        }
        onRefresh={() =>
          void loadData()
        }
        onImportCsv={
          chooseCsvImport
        }
        onExportCsv={() =>
          void exportCsv()
        }
        onSettings={() =>
          navigate(
            "/settings",
          )
        }
        onAbout={() =>
          setAboutOpen(
            true,
          )
        }
        onLogout={() =>
          void logout()
        }
        onStatus={
          setStatus
        }
        onNavigationVisible={
          setNavigationVisible
        }
        onDetailVisible={
          setDetailVisible
        }
        onNavigationPosition={(position) =>
          dockPanelAtEdge(
            "navigation",
            position,
          )
        }
        onDetailPosition={(position) =>
          dockPanelAtEdge(
            "detail",
            position,
          )
        }
        onColumnVisible={
          setColumnVisible
        }
        onShowAllColumns={
          showAllColumns
        }
        onResetColumns={
          resetColumns
        }
      />


      <div
        className="workspace"
        ref={workspaceRef}
      >

        {
          dockDrag
          && (
            <>
              <div
                className={[
                  "dock-drop-zone",
                  "dock-drop-zone-left",
                  dockDrag.target === "left-edge"
                    ? "active"
                    : "",
                ]
                  .filter(
                    Boolean,
                  )
                  .join(
                    " ",
                  )}
              >
                Ganz links andocken
              </div>

              <div
                className={[
                  "dock-drop-zone",
                  "dock-drop-zone-right",
                  dockDrag.target === "right-edge"
                    ? "active"
                    : "",
                ]
                  .filter(
                    Boolean,
                  )
                  .join(
                    " ",
                  )}
              >
                Ganz rechts andocken
              </div>
            </>
          )
        }


        {
          dockOrder
            .filter(
              (panel) =>
                panelPosition(
                  panel,
                ) === "left",
            )
            .map(
              (panel) => (
                <Fragment
                  key={
                    `left-${panel}`
                  }
                >
                  {
                    dockShell(
                      panel,
                      panelContent(
                        panel,
                      ),
                    )
                  }
                </Fragment>
              ),
            )
        }


        <main className="inventory-area">

          <div className="page-header">

            <h1>
              IT-Inventar
            </h1>


            <span>
              {countText}
            </span>

          </div>


          <InventoryTable
            rows={filteredRows}
            columns={
              displayedColumns
            }
            allColumns={
              availableColumns
            }
            visibleColumns={
              visibleColumns
            }
            selectedKeys={
              selectedKeys
            }
            loading={
              loading
            }
            getRowKey={
              getRowKey
            }
            getHeaderLabel={
              getHeaderLabel
            }
            formatValue={
              formatValue
            }
            onSelectionChange={
              setSelectedKeys
            }
            onMoveColumn={
              moveColumn
            }
            onColumnVisible={
              setColumnVisible
            }
            onShowAllColumns={
              showAllColumns
            }
            onResetColumns={
              resetColumns
            }
          />

        </main>


        {
          dockOrder
            .filter(
              (panel) =>
                panelPosition(
                  panel,
                ) === "right",
            )
            .map(
              (panel) => (
                <Fragment
                  key={
                    `right-${panel}`
                  }
                >
                  {
                    dockShell(
                      panel,
                      panelContent(
                        panel,
                      ),
                    )
                  }
                </Fragment>
              ),
            )
        }

      </div>


      {
        aboutOpen
        && (
          <div
            className="about-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.target
                === event.currentTarget
              ) {
                setAboutOpen(
                  false,
                );
              }
            }}
          >

            <div
              className="about-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="about-dialog-title"
            >

              <button
                type="button"
                className="about-close-button"
                aria-label="Über-Fenster schliessen"
                title="Schliessen"
                onClick={() =>
                  setAboutOpen(
                    false,
                  )
                }
              >
                ×
              </button>


              <div className="about-icon">
                i
              </div>


              <div className="about-dialog-content">

                <h2
                  id="about-dialog-title"
                >
                  ITAssetFlow
                </h2>

                <p>
                  Inventarverwaltung für IT-Materialien.
                </p>

                <p>
                  Datenbank und Authentifizierung über Supabase.
                </p>

                <p className="about-company">
                  DLC-Informatik GmbH
                </p>

              </div>


              <div className="about-dialog-actions">

                <button
                  type="button"
                  className="primary-button"
                  autoFocus
                  onClick={() =>
                    setAboutOpen(
                      false,
                    )
                  }
                >
                  OK
                </button>

              </div>

            </div>

          </div>
        )
      }


      <div className="status-bar">

        <span>
          {status}
        </span>


        <div className="status-user">
          Angemeldet: {email}
        </div>

      </div>

    </div>
  );
}