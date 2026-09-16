import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";


type InventoryRow =
  Record<string, unknown>;


type SortDirection =
  "asc"
  | "desc";


type HeaderContextMenuState = {
  x: number;
  y: number;
} | null;


type InventoryTableProps = {
  rows: InventoryRow[];

  columns: string[];

  allColumns: string[];

  visibleColumns: Set<string>;

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

  onColumnVisible: (
    column: string,
    visible: boolean,
  ) => void;

  onShowAllColumns: () => void;

  onResetColumns: () => void;
};


const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 700;


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


function clampColumnWidth(
  width: number,
): number {
  return Math.max(
    MIN_COLUMN_WIDTH,
    Math.min(
      MAX_COLUMN_WIDTH,
      Math.round(width),
    ),
  );
}


export default function InventoryTable({
  rows,
  columns,
  allColumns,
  visibleColumns,
  selectedKeys,
  loading,
  getRowKey,
  getHeaderLabel,
  formatValue,
  onSelectionChange,
  onMoveColumn,
  onColumnVisible,
  onShowAllColumns,
  onResetColumns,
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

  const [
    columnWidths,
    setColumnWidths,
  ] = useState<Record<string, number>>(
    {},
  );

  const [
    headerContextMenu,
    setHeaderContextMenu,
  ] = useState<HeaderContextMenuState>(
    null,
  );


  const mouseSelectingRef =
    useRef(false);

  const dragAnchorIndexRef =
    useRef<number | null>(
      null,
    );

  const dragCurrentIndexRef =
    useRef<number | null>(
      null,
    );

  const dragBaseSelectionRef =
    useRef<Set<string>>(
      new Set(),
    );

  const dragAdditiveRef =
    useRef(false);

  const resizingColumnRef =
    useRef<string | null>(
      null,
    );

  const contextMenuRef =
    useRef<HTMLDivElement | null>(
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


  useEffect(
    () => {
      function finishMouseSelection(): void {
        if (
          !mouseSelectingRef.current
        ) {
          return;
        }

        mouseSelectingRef.current =
          false;

        if (
          dragCurrentIndexRef.current
          !== null
        ) {
          setLastSelectedIndex(
            dragCurrentIndexRef.current,
          );
        }

        dragAnchorIndexRef.current =
          null;

        dragCurrentIndexRef.current =
          null;

        dragBaseSelectionRef.current =
          new Set();

        dragAdditiveRef.current =
          false;
      }


      window.addEventListener(
        "mouseup",
        finishMouseSelection,
      );

      window.addEventListener(
        "blur",
        finishMouseSelection,
      );


      return () => {
        window.removeEventListener(
          "mouseup",
          finishMouseSelection,
        );

        window.removeEventListener(
          "blur",
          finishMouseSelection,
        );
      };
    },
    [],
  );


  useEffect(
    () => {
      function closeContextMenu(
        event: MouseEvent,
      ): void {
        if (
          contextMenuRef.current
          && contextMenuRef.current.contains(
            event.target as Node,
          )
        ) {
          return;
        }

        setHeaderContextMenu(
          null,
        );
      }


      function escapeContextMenu(
        event: KeyboardEvent,
      ): void {
        if (
          event.key === "Escape"
        ) {
          setHeaderContextMenu(
            null,
          );
        }
      }


      window.addEventListener(
        "mousedown",
        closeContextMenu,
      );

      window.addEventListener(
        "keydown",
        escapeContextMenu,
      );


      return () => {
        window.removeEventListener(
          "mousedown",
          closeContextMenu,
        );

        window.removeEventListener(
          "keydown",
          escapeContextMenu,
        );
      };
    },
    [],
  );


  function defaultColumnWidth(
    column: string,
  ): number {
    const headerLength =
      getHeaderLabel(
        column,
      ).length;

    return clampColumnWidth(
      Math.max(
        115,
        headerLength * 8 + 42,
      ),
    );
  }


  function columnWidth(
    column: string,
  ): number {
    return (
      columnWidths[column]
      ?? defaultColumnWidth(
        column,
      )
    );
  }


  function toggleSort(
    column: string,
  ): void {
    if (
      resizingColumnRef.current
    ) {
      return;
    }

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


  function createRangeSelection(
    startIndex: number,
    endIndex: number,
    baseSelection: Set<string>,
  ): Set<string> {
    const start =
      Math.min(
        startIndex,
        endIndex,
      );

    const end =
      Math.max(
        startIndex,
        endIndex,
      );

    const next =
      new Set(
        baseSelection,
      );

    for (
      let index = start;
      index <= end;
      index += 1
    ) {
      const row =
        displayedRows[index];

      if (!row) {
        continue;
      }

      next.add(
        getRowKey(
          row,
        ),
      );
    }

    return next;
  }


  function beginRowSelection(
    row: InventoryRow,
    rowIndex: number,
    ctrlKey: boolean,
    shiftKey: boolean,
  ): void {
    const key =
      getRowKey(
        row,
      );

    mouseSelectingRef.current =
      true;

    dragCurrentIndexRef.current =
      rowIndex;


    if (
      shiftKey
      && lastSelectedIndex !== null
    ) {
      dragAnchorIndexRef.current =
        lastSelectedIndex;

      dragAdditiveRef.current =
        ctrlKey;

      dragBaseSelectionRef.current =
        ctrlKey
          ? new Set(
              selectedKeys,
            )
          : new Set();

      onSelectionChange(
        createRangeSelection(
          lastSelectedIndex,
          rowIndex,
          dragBaseSelectionRef.current,
        ),
      );

      return;
    }


    dragAnchorIndexRef.current =
      rowIndex;

    dragAdditiveRef.current =
      ctrlKey;

    dragBaseSelectionRef.current =
      ctrlKey
        ? new Set(
            selectedKeys,
          )
        : new Set();


    if (ctrlKey) {
      const next =
        new Set(
          selectedKeys,
        );

      if (
        next.has(
          key,
        )
      ) {
        next.delete(
          key,
        );
      } else {
        next.add(
          key,
        );
      }

      onSelectionChange(
        next,
      );

      return;
    }


    onSelectionChange(
      new Set([
        key,
      ]),
    );
  }


  function extendRowSelection(
    rowIndex: number,
    mouseButtons: number,
  ): void {
    if (
      !mouseSelectingRef.current
    ) {
      return;
    }

    if (
      (mouseButtons & 1) !== 1
    ) {
      mouseSelectingRef.current =
        false;

      return;
    }

    const anchorIndex =
      dragAnchorIndexRef.current;

    if (
      anchorIndex === null
    ) {
      return;
    }

    if (
      dragCurrentIndexRef.current
      === rowIndex
    ) {
      return;
    }

    dragCurrentIndexRef.current =
      rowIndex;

    const baseSelection =
      dragAdditiveRef.current
        ? dragBaseSelectionRef.current
        : new Set<string>();

    onSelectionChange(
      createRangeSelection(
        anchorIndex,
        rowIndex,
        baseSelection,
      ),
    );
  }


  function beginColumnResize(
    column: string,
    startX: number,
  ): void {
    const startWidth =
      columnWidth(
        column,
      );

    resizingColumnRef.current =
      column;

    document.body.classList.add(
      "column-resizing",
    );


    function move(
      event: MouseEvent,
    ): void {
      const width =
        clampColumnWidth(
          startWidth
          + event.clientX
          - startX,
        );

      setColumnWidths(
        (current) => ({
          ...current,
          [column]:
            width,
        }),
      );
    }


    function finish(): void {
      resizingColumnRef.current =
        null;

      document.body.classList.remove(
        "column-resizing",
      );

      window.removeEventListener(
        "mousemove",
        move,
      );

      window.removeEventListener(
        "mouseup",
        finish,
      );
    }


    window.addEventListener(
      "mousemove",
      move,
    );

    window.addEventListener(
      "mouseup",
      finish,
    );
  }


  function autoFitColumn(
    column: string,
  ): void {
    let longest =
      getHeaderLabel(
        column,
      ).length;

    for (
      const row
      of displayedRows.slice(
        0,
        250,
      )
    ) {
      longest =
        Math.max(
          longest,
          formatValue(
            column,
            row[column],
          ).length,
        );
    }

    setColumnWidths(
      (current) => ({
        ...current,
        [column]:
          clampColumnWidth(
            longest * 8 + 34,
          ),
      }),
    );
  }


  function openHeaderContextMenu(
    clientX: number,
    clientY: number,
  ): void {
    const menuWidth =
      285;

    const estimatedMenuHeight =
      Math.min(
        520,
        110 + allColumns.length * 34,
      );

    setHeaderContextMenu({
      x:
        Math.max(
          8,
          Math.min(
            clientX,
            window.innerWidth
            - menuWidth
            - 8,
          ),
        ),

      y:
        Math.max(
          8,
          Math.min(
            clientY,
            window.innerHeight
            - estimatedMenuHeight
            - 8,
          ),
        ),
    });
  }


  return (
    <div className="table-wrapper">

      <table className="inventory-table">

        <colgroup>

          {
            columns.map(
              (column) => (
                <col
                  key={column}
                  style={{
                    width:
                      `${columnWidth(column)}px`,
                  }}
                />
              ),
            )
          }

        </colgroup>


        <thead>

          <tr>

            {
              columns.map(
                (column) => (
                  <th
                    key={column}
                    draggable
                    style={{
                      width:
                        `${columnWidth(column)}px`,
                    }}
                    title={
                      "Klicken zum Sortieren · Ziehen zum Verschieben · "
                      + "Rand ziehen zum Ändern der Breite · Rechtsklick für Spalten"
                    }
                    onClick={() =>
                      toggleSort(
                        column,
                      )
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();

                      openHeaderContextMenu(
                        event.clientX,
                        event.clientY,
                      );
                    }}
                    onDragStart={(event) => {
                      if (
                        resizingColumnRef.current
                      ) {
                        event.preventDefault();

                        return;
                      }

                      setDraggedColumn(
                        column,
                      );
                    }}
                    onDragEnd={() =>
                      setDraggedColumn(
                        null,
                      )
                    }
                    onDragOver={(event) =>
                      event.preventDefault()
                    }
                    onDrop={() => {
                      if (
                        draggedColumn
                      ) {
                        onMoveColumn(
                          draggedColumn,
                          column,
                        );
                      }

                      setDraggedColumn(
                        null,
                      );
                    }}
                  >

                    <span className="table-header-content">

                      <span className="table-header-label">
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


                    <span
                      className="column-resize-handle"
                      title="Ziehen zum Ändern der Spaltenbreite · Doppelklick für automatische Breite"
                      draggable={false}
                      onClick={(event) =>
                        event.stopPropagation()
                      }
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();

                        autoFitColumn(
                          column,
                        );
                      }}
                      onDragStart={(event) =>
                        event.preventDefault()
                      }
                      onMouseDown={(event) => {
                        if (
                          event.button !== 0
                        ) {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();

                        beginColumnResize(
                          column,
                          event.clientX,
                        );
                      }}
                    />

                  </th>
                ),
              )
            }

          </tr>

        </thead>


        <tbody
          style={{
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >

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
                    onMouseDown={(event) => {
                      if (
                        event.button !== 0
                      ) {
                        return;
                      }

                      event.preventDefault();

                      beginRowSelection(
                        row,
                        rowIndex,
                        event.ctrlKey
                          || event.metaKey,
                        event.shiftKey,
                      );
                    }}
                    onMouseEnter={(event) =>
                      extendRowSelection(
                        rowIndex,
                        event.buttons,
                      )
                    }
                  >

                    {
                      columns.map(
                        (column) => (
                          <td
                            key={column}
                            style={{
                              width:
                                `${columnWidth(column)}px`,
                            }}
                            title={
                              formatValue(
                                column,
                                row[column],
                              )
                            }
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


      {
        headerContextMenu
        && (
          <div
            ref={contextMenuRef}
            className="header-context-menu"
            style={{
              left:
                headerContextMenu.x,
              top:
                headerContextMenu.y,
            }}
            role="menu"
            aria-label="Spaltenauswahl"
          >

            <button
              type="button"
              onClick={
                onShowAllColumns
              }
            >
              Alle einblenden
            </button>


            <button
              type="button"
              onClick={
                onResetColumns
              }
            >
              Standardansicht
            </button>


            <div className="header-context-separator" />


            <div className="header-context-column-list">

              {
                allColumns.map(
                  (column) => (
                    <label
                      key={column}
                      className="header-context-option"
                    >

                      <input
                        type="checkbox"
                        checked={
                          visibleColumns.has(
                            column,
                          )
                        }
                        onChange={(event) =>
                          onColumnVisible(
                            column,
                            event.target.checked,
                          )
                        }
                      />

                      <span>
                        {
                          getHeaderLabel(
                            column,
                          )
                        }
                      </span>

                    </label>
                  ),
                )
              }

            </div>

          </div>
        )
      }

    </div>
  );
}
