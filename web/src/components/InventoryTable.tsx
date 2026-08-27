import {
  useMemo,
  useState,
} from "react";


type InventoryRow =
  Record<string, unknown>;


type SortDirection =
  "asc"
  | "desc";


type InventoryTableProps = {
  rows: InventoryRow[];

  columns: string[];

  selectedKeys: Set<string>;

  loading: boolean;

  getRowKey: (
    row: InventoryRow,
  ) => string;

  getHeaderLabel: (
    column: string,
  ) => string;

  formatValue: (
    column: string,
    value: unknown,
  ) => string;

  onSelectionChange: (
    selection: Set<string>,
  ) => void;

  onMoveColumn: (
    source: string,
    target: string,
  ) => void;
};


function compareValues(
  left: unknown,
  right: unknown,
): number {
  if (
    typeof left === "number"
    && typeof right === "number"
  ) {
    return left - right;
  }

  const leftNumber =
    Number(left);

  const rightNumber =
    Number(right);

  if (
    left !== ""
    && right !== ""
    && Number.isFinite(
      leftNumber,
    )
    && Number.isFinite(
      rightNumber,
    )
  ) {
    return leftNumber - rightNumber;
  }

  return String(
    left ?? "",
  ).localeCompare(
    String(
      right ?? "",
    ),
    "de-CH",
    {
      numeric: true,
      sensitivity: "base",
    },
  );
}


export default function InventoryTable({
  rows,
  columns,
  selectedKeys,
  loading,
  getRowKey,
  getHeaderLabel,
  formatValue,
  onSelectionChange,
  onMoveColumn,
}: InventoryTableProps) {
  const [
    sortColumn,
    setSortColumn,
  ] = useState<string | null>(
    null,
  );

  const [
    sortDirection,
    setSortDirection,
  ] = useState<SortDirection>(
    "asc",
  );

  const [
    draggedColumn,
    setDraggedColumn,
  ] = useState<string | null>(
    null,
  );

  const [
    lastSelectedIndex,
    setLastSelectedIndex,
  ] = useState<number | null>(
    null,
  );


  const displayedRows =
    useMemo(
      () => {
        if (!sortColumn) {
          return rows;
        }

        const result =
          [...rows];

        result.sort(
          (left, right) => {
            const comparison =
              compareValues(
                left[sortColumn],
                right[sortColumn],
              );

            return (
              sortDirection === "asc"
                ? comparison
                : -comparison
            );
          },
        );

        return result;
      },
      [
        rows,
        sortColumn,
        sortDirection,
      ],
    );


  function toggleSort(
    column: string,
  ): void {
    if (
      sortColumn !== column
    ) {
      setSortColumn(
        column,
      );

      setSortDirection(
        "asc",
      );

      return;
    }

    setSortDirection(
      (current) =>
        current === "asc"
          ? "desc"
          : "asc",
    );
  }


  function selectRow(
    row: InventoryRow,
    rowIndex: number,
    ctrlKey: boolean,
    shiftKey: boolean,
  ): void {
    const key =
      getRowKey(
        row,
      );

    if (
      shiftKey
      && lastSelectedIndex !== null
    ) {
      const start =
        Math.min(
          lastSelectedIndex,
          rowIndex,
        );

      const end =
        Math.max(
          lastSelectedIndex,
          rowIndex,
        );

      const range =
        displayedRows.slice(
          start,
          end + 1,
        );

      const next =
        ctrlKey
          ? new Set(
              selectedKeys,
            )
          : new Set<string>();

      for (
        const currentRow
        of range
      ) {
        next.add(
          getRowKey(
            currentRow,
          ),
        );
      }

      onSelectionChange(
        next,
      );

      return;
    }


    if (ctrlKey) {
      const next =
        new Set(
          selectedKeys,
        );

      if (
        next.has(key)
      ) {
        next.delete(
          key,
        );
      } else {
        next.add(
          key,
        );
      }

      setLastSelectedIndex(
        rowIndex,
      );

      onSelectionChange(
        next,
      );

      return;
    }


    setLastSelectedIndex(
      rowIndex,
    );

    onSelectionChange(
      new Set([
        key,
      ]),
    );
  }


  return (
    <div
      className={
        draggedColumn
          ? "table-wrapper column-dragging"
          : "table-wrapper"
      }
    >

      <table className="inventory-table">

        <thead>

          <tr>

            {
              columns.map(
                (column) => (
                  <th
                    key={column}
                    draggable
                    title="Klicken zum Sortieren · Ziehen zum Verschieben"
                    onMouseDown={(event) => {
                      if (
                        event.button === 0
                      ) {
                        event.preventDefault();
                      }
                    }}
                    onClick={() =>
                      toggleSort(
                        column,
                      )
                    }
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed =
                        "move";

                      event.dataTransfer.setData(
                        "text/plain",
                        column,
                      );

                      setDraggedColumn(
                        column,
                      );
                    }}
                    onDragEnd={() =>
                      setDraggedColumn(
                        null,
                      )
                    }
                    onDragOver={(event) => {
                      event.preventDefault();

                      event.dataTransfer.dropEffect =
                        "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();

                      const source =
                        draggedColumn
                        || event.dataTransfer.getData(
                          "text/plain",
                        );

                      if (source) {
                        onMoveColumn(
                          source,
                          column,
                        );
                      }

                      setDraggedColumn(
                        null,
                      );
                    }}
                  >

                    <span className="table-header-content">

                      <span>
                        {
                          getHeaderLabel(
                            column,
                          )
                        }
                      </span>


                      {
                        sortColumn === column
                        && (
                          <span className="sort-indicator">
                            {
                              sortDirection === "asc"
                                ? "▲"
                                : "▼"
                            }
                          </span>
                        )
                      }

                    </span>

                  </th>
                ),
              )
            }

          </tr>

        </thead>


        <tbody>

          {
            displayedRows.map(
              (
                row,
                rowIndex,
              ) => {
                const key =
                  getRowKey(
                    row,
                  );

                return (
                  <tr
                    key={key}
                    className={
                      selectedKeys.has(
                        key,
                      )
                        ? "selected"
                        : ""
                    }
                    onClick={(event) =>
                      selectRow(
                        row,
                        rowIndex,
                        event.ctrlKey
                          || event.metaKey,
                        event.shiftKey,
                      )
                    }
                  >

                    {
                      columns.map(
                        (column) => (
                          <td
                            key={column}
                          >
                            {
                              formatValue(
                                column,
                                row[column],
                              )
                            }
                          </td>
                        ),
                      )
                    }

                  </tr>
                );
              },
            )
          }


          {
            !loading
            && displayedRows.length === 0
            && (
              <tr>

                <td
                  className="empty-table"
                  colSpan={
                    Math.max(
                      columns.length,
                      1,
                    )
                  }
                >
                  Keine Inventareinträge gefunden.
                </td>

              </tr>
            )
          }

        </tbody>

      </table>

    </div>
  );
}
