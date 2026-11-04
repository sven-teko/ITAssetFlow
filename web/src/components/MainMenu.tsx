import {
  useEffect,
  useId,
  useLayoutEffect,
  type RefObject,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./MainMenu.css";
import type { InventorySort } from "./InventoryTable";


export type DockPosition =
  "left"
  | "right";


type MainMenuProps = {
  workspaceTabs: ReactNode;
  inventoryAreaRef: RefObject<HTMLElement | null>;
  toolbarLayoutKey: string;
  compactLayout: boolean;
  sort: InventorySort;
  onSort: (sort: InventorySort) => void;
  onScan: () => void;
  navigationVisible: boolean;
  detailVisible: boolean;

  navigationPosition: DockPosition;
  detailPosition: DockPosition;

  columns: string[];
  visibleColumns: Set<string>;

  transferBusy: boolean;

  canManageSettings: boolean;

  getHeaderLabel: (
    column: string,
  ) => string;

  onRefresh: () => void;

  onImportCsv: () => void;
  onExportCsv: () => void;
  onExportPostgresql: () => void;

  onSettings: () => void;
  onArchive: () => void;
  onAbout: () => void;
  onLogout: () => void;

  onStatus: (
    text: string,
  ) => void;

  onNavigationVisible: (
    visible: boolean,
  ) => void;

  onDetailVisible: (
    visible: boolean,
  ) => void;

  onNavigationPosition: (
    position: DockPosition,
  ) => void;

  onDetailPosition: (
    position: DockPosition,
  ) => void;

  onColumnVisible: (
    column: string,
    visible: boolean,
  ) => void;

  onShowAllColumns: () => void;
  onResetColumns: () => void;
};


type MenuName =
  "file"
  | "options"
  | "help"
  | null;


type DockPanelMenuProps = {
  title: string;
  visible: boolean;
  position: DockPosition;
  onVisibleChange: (visible: boolean) => void;
  onPositionChange: (position: DockPosition) => void;
};

const DOCK_POSITIONS = [
  { value: "left", label: "Links andocken" },
  { value: "right", label: "Rechts andocken" },
] as const;

function DockPanelMenu({
  title,
  visible,
  position,
  onVisibleChange,
  onPositionChange,
}: DockPanelMenuProps) {
  const groupId = useId();

  return (
    <div className="menu-submenu dock-panel-menu">
      <button type="button" aria-label={`${title}: Optionen`}>
        <span>{title}</span>
        <span className="dock-menu-chevron" aria-hidden="true">›</span>
      </button>
      <div className="submenu-popup dock-panel-popup" aria-label={`${title}: Optionen`}>
        <label className="dock-menu-option">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => onVisibleChange(event.target.checked)}
          />
          <span>{title} anzeigen</span>
        </label>
        <div className="menu-separator" />
        <fieldset className="dock-menu-position" aria-label={`${title}: Position`}>
          {DOCK_POSITIONS.map(({ value, label }) => (
            <label
              key={value}
              className={`dock-menu-option${position === value ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name={groupId}
                value={value}
                checked={position === value}
                onClick={() => {
                  if (position === value) onPositionChange(value);
                }}
                onChange={() => onPositionChange(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}


export default function MainMenu({
  workspaceTabs,
  inventoryAreaRef,
  toolbarLayoutKey,
  compactLayout,
  sort,
  onSort,
  onScan,
  navigationVisible,
  detailVisible,
  navigationPosition,
  detailPosition,
  columns,
  visibleColumns,
  transferBusy,
  canManageSettings,
  getHeaderLabel,
  onRefresh,
  onImportCsv,
  onExportCsv,
  onExportPostgresql,
  onSettings,
  onArchive,
  onAbout,
  onLogout,
  onStatus,
  onNavigationVisible,
  onDetailVisible,
  onNavigationPosition,
  onDetailPosition,
  onColumnVisible,
  onShowAllColumns,
  onResetColumns,
}: MainMenuProps) {
  const [
    openMenu,
    setOpenMenu,
  ] = useState<MenuName>(
    null,
  );

  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    );


  useLayoutEffect(() => {
    const root = rootRef.current;
    const leading = root?.querySelector(".menu-leading-end");
    const trailing = root?.querySelector(".menu-logout-button");
    if (!root || !leading || !trailing) return;
    if (compactLayout) {
      delete root.dataset.toolbarRow;
      return;
    }

    const syncToolbar = () => {
      const center = inventoryAreaRef.current?.getBoundingClientRect();
      if (!center || center.width <= 0) return;
      const menu = root.getBoundingClientRect();
      root.style.setProperty("--inventory-left", `${Math.max(0, center.left - menu.left)}px`);
      root.style.setProperty("--inventory-right", `${Math.max(0, menu.right - center.right)}px`);
      const requiredWidth = (root.querySelector(".workspace-tabs")?.scrollWidth ?? 0)
        + (root.querySelector(".menu-scanner-button")?.scrollWidth ?? 0) + 12;
      root.dataset.toolbarRow = center.width < requiredWidth || center.left < leading.getBoundingClientRect().right + 8
        || center.right > trailing.getBoundingClientRect().left - 8 ? "separate" : "inline";
    };
    syncToolbar();
    const resize = new ResizeObserver(syncToolbar);
    for (const element of [root, leading, trailing]) resize.observe(element);
    const frame = requestAnimationFrame(() => {
      // The inventory panel is a sibling and may mount after this layout effect.
      if (inventoryAreaRef.current) resize.observe(inventoryAreaRef.current);
      syncToolbar();
    });
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [compactLayout, inventoryAreaRef, toolbarLayoutKey]);

  useEffect(
    () => {
      function closeOutside(
        event: MouseEvent,
      ): void {
        if (
          rootRef.current
          && !rootRef.current.contains(
            event.target as Node,
          )
        ) {
          setOpenMenu(
            null,
          );
        }
      }

      function escape(
        event: KeyboardEvent,
      ): void {
        if (
          event.key === "Escape"
        ) {
          setOpenMenu(
            null,
          );
        }
      }

      document.addEventListener(
        "mousedown",
        closeOutside,
      );

      document.addEventListener(
        "keydown",
        escape,
      );

      return () => {
        document.removeEventListener(
          "mousedown",
          closeOutside,
        );

        document.removeEventListener(
          "keydown",
          escape,
        );
      };
    },
    [],
  );


  function toggleMenu(
    name: MenuName,
  ): void {
    setOpenMenu(
      (current) =>
        current === name
          ? null
          : name,
    );
  }


  function action(
    callback: () => void,
  ): void {
    setOpenMenu(
      null,
    );

    callback();
  }


  return (
    <div
      className={`menu-bar${compactLayout ? " menu-bar-compact" : ""}`}
      ref={rootRef}
    >

      <div
        className="menu-brand"
        title="ITAssetFlow"
        aria-label="ITAssetFlow"
      >
        <img
          className="menu-brand-logo"
          src="/logo.png"
          alt="ITAssetFlow"
          draggable={false}
        />
      </div>


      <div className="top-menu">

        <button
          type="button"
          className={
            openMenu === "file"
              ? "top-menu-button active"
              : "top-menu-button"
          }
          onClick={() =>
            toggleMenu(
              "file",
            )
          }
        >
          Datei
        </button>


        {
          openMenu === "file"
          && (
            <div className="menu-popup">

              <button
                type="button"
                onClick={() =>
                  action(
                    onRefresh,
                  )
                }
              >
                <span>
                  Jetzt aktualisieren
                </span>

                <span className="menu-shortcut">
                  F5
                </span>
              </button>


              <div className="menu-separator" />

              <button type="button" onClick={() => action(onArchive)}>Archiv</button>


              <div className="menu-submenu">

                <button type="button">
                  <span>
                    Import
                  </span>

                  <span>
                    ›
                  </span>
                </button>


                <div className="submenu-popup">

                  <button
                    type="button"
                    disabled={transferBusy || !canManageSettings}
                    onClick={() =>
                      action(
                        onImportCsv,
                      )
                    }
                  >
                    CSV
                  </button>

                  <button
                    type="button"
                    disabled={transferBusy || !canManageSettings}
                    onClick={() =>
                      action(
                        () =>
                          onStatus(
                            "PostgreSQL-Import ist in der WebApp noch nicht aktiviert.",
                          ),
                      )
                    }
                  >
                    PostgreSQL
                  </button>

                </div>

              </div>


              <div className="menu-submenu">

                <button type="button">
                  <span>
                    Export
                  </span>

                  <span>
                    ›
                  </span>
                </button>


                <div className="submenu-popup">

                  <button
                    type="button"
                    disabled={transferBusy}
                    onClick={() =>
                      action(
                        onExportCsv,
                      )
                    }
                  >
                    CSV
                  </button>

                  <button
                    type="button"
                    disabled={transferBusy}
                    onClick={() =>
                      action(
                        onExportPostgresql,
                      )
                    }
                  >
                    PostgreSQL
                  </button>

                </div>

              </div>


              {
                canManageSettings
                && (
                  <>
                    <div className="menu-separator" />

                    <button
                      type="button"
                      onClick={() =>
                        action(
                          onSettings,
                        )
                      }
                    >
                      Einstellungen
                    </button>
                  </>
                )
              }


              <div className="menu-separator" />


              <button
                type="button"
                onClick={() =>
                  action(
                    onLogout,
                  )
                }
              >
                Beenden
              </button>

            </div>
          )
        }

      </div>


      <div className="top-menu">

        <button
          type="button"
          className={
            openMenu === "options"
              ? "top-menu-button active"
              : "top-menu-button"
          }
          onClick={() =>
            toggleMenu(
              "options",
            )
          }
        >
          Optionen
        </button>


        {
          openMenu === "options"
          && (
            <div className="menu-popup">

              <details className="menu-sort">
                <summary>Sortieren nach</summary>
                <div className="menu-sort-field">
                  <label htmlFor="inventory-sort-direction">Reihenfolge</label>
                  <select id="inventory-sort-direction" value={sort.direction} onChange={event =>
                    onSort({ ...sort, direction: event.target.value === "desc" ? "desc" : "asc" })}>
                    <option value="asc">Aufsteigend</option>
                    <option value="desc">Absteigend</option>
                  </select>
                </div>
                <div className="menu-sort-field">
                  <label htmlFor="inventory-sort-column">Spalte</label>
                  <select id="inventory-sort-column" value={sort.column ?? ""} onChange={event =>
                    onSort({ ...sort, column: event.target.value || null })}>
                    <option value="">Keine Sortierung</option>
                    {columns.map(column => <option key={column} value={column}>{getHeaderLabel(column)}</option>)}
                  </select>
                </div>
              </details>
              {!compactLayout && <>
                <div className="menu-separator" />

                <DockPanelMenu
                  title="Navigation"
                  visible={navigationVisible}
                  position={navigationPosition}
                  onVisibleChange={onNavigationVisible}
                  onPositionChange={onNavigationPosition}
                />
                <DockPanelMenu
                  title="Detailansicht"
                  visible={detailVisible}
                  position={detailPosition}
                  onVisibleChange={onDetailVisible}
                  onPositionChange={onDetailPosition}
                />
              </>}


              <div className="menu-separator" />


              <div className="menu-submenu">

                <button type="button">

                  <span>
                    Spalten
                  </span>

                  <span>
                    ›
                  </span>

                </button>


                <div className="submenu-popup column-submenu">

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


                  <div className="menu-separator" />


                  {
                    columns.map(
                      (column) => (
                        <label
                          className="menu-check-option"
                          key={column}
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

            </div>
          )
        }

      </div>


      <div className="top-menu menu-leading-end">

        <button
          type="button"
          className={
            openMenu === "help"
              ? "top-menu-button active"
              : "top-menu-button"
          }
          onClick={() =>
            toggleMenu(
              "help",
            )
          }
        >
          Hilfe
        </button>


        {
          openMenu === "help"
          && (
            <div className="menu-popup">

              <button
                type="button"
                onClick={() =>
                  action(
                    onAbout,
                  )
                }
              >
                Über
              </button>

            </div>
          )
        }

      </div>


      <div className="menu-inventory-toolbar">
        <div onClick={() => setOpenMenu(null)}>{workspaceTabs}</div>
        <button type="button" className="primary-button menu-scanner-button" onClick={() => action(onScan)}>
          Scanner
        </button>
      </div>


      <button
        type="button"
        className="menu-logout-button"
        aria-label="Abmelden"
        title="Abmelden"
        onClick={() =>
          action(
            onLogout,
          )
        }
      >
        <span>Abmelden</span>
        <svg className="menu-power-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M12 3v9" />
          <path d="M6.3 5.7a9 9 0 1 0 11.4 0" />
        </svg>
      </button>

    </div>
  );
}
