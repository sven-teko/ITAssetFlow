import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
    transferBusy,
    setTransferBusy,
  ] = useState(false);


  const csvFileInputRef =
    useRef<HTMLInputElement | null>(
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
          navigate(
            "/about",
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
        onNavigationPosition={
          setNavigationPosition
        }
        onDetailPosition={
          setDetailPosition
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


      <div className="workspace">

        {
          navigationPosition === "left"
          && navigationPanel
        }


        {
          detailPosition === "left"
          && detailPanel
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
          />

        </main>


        {
          detailPosition === "right"
          && detailPanel
        }


        {
          navigationPosition === "right"
          && navigationPanel
        }

      </div>


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