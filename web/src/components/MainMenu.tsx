import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import "./MainMenu.css";


export type DockPosition =
  "left"
  | "right";


type MainMenuProps = {
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

  onSettings: () => void;
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
  onSettings,
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
      className="menu-bar"
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
                        () =>
                          onStatus(
                            "PostgreSQL-Export ist in der WebApp noch nicht aktiviert.",
                          ),
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


      <div className="top-menu">

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


      <div className="menu-bar-spacer" />


      <button
        type="button"
        className="menu-logout-button"
        onClick={() =>
          action(
            onLogout,
          )
        }
      >
        Abmelden
      </button>

    </div>
  );
}
