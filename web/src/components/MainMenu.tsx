import {
  useEffect,
  useRef,
  useState,
} from "react";


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


export default function MainMenu({
  navigationVisible,
  detailVisible,
  navigationPosition,
  detailPosition,
  columns,
  visibleColumns,
  transferBusy,
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
                    disabled={transferBusy}
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
                    disabled={transferBusy}
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

              <div className="menu-submenu">

                <button type="button">
                  <span>
                    Navigation
                  </span>

                  <span>
                    ›
                  </span>
                </button>


                <div className="submenu-popup">

                  <label className="menu-check-option">

                    <input
                      type="checkbox"
                      checked={
                        navigationVisible
                      }
                      onChange={(event) =>
                        onNavigationVisible(
                          event.target.checked,
                        )
                      }
                    />

                    <span>
                      Navigation anzeigen
                    </span>

                  </label>


                  <div className="menu-separator" />


                  <button
                    type="button"
                    className={
                      navigationPosition === "left"
                        ? "checked-menu-button"
                        : ""
                    }
                    onClick={() =>
                      onNavigationPosition(
                        "left",
                      )
                    }
                  >
                    Links andocken
                  </button>


                  <button
                    type="button"
                    className={
                      navigationPosition === "right"
                        ? "checked-menu-button"
                        : ""
                    }
                    onClick={() =>
                      onNavigationPosition(
                        "right",
                      )
                    }
                  >
                    Rechts andocken
                  </button>


                  <button
                    type="button"
                    disabled
                    title="Wird später umgesetzt"
                  >
                    Navigation lösen
                  </button>

                </div>

              </div>


              <div className="menu-submenu">

                <button type="button">

                  <span>
                    Detailansicht
                  </span>

                  <span>
                    ›
                  </span>

                </button>


                <div className="submenu-popup">

                  <label className="menu-check-option">

                    <input
                      type="checkbox"
                      checked={
                        detailVisible
                      }
                      onChange={(event) =>
                        onDetailVisible(
                          event.target.checked,
                        )
                      }
                    />

                    <span>
                      Detailansicht anzeigen
                    </span>

                  </label>


                  <div className="menu-separator" />


                  <button
                    type="button"
                    className={
                      detailPosition === "left"
                        ? "checked-menu-button"
                        : ""
                    }
                    onClick={() =>
                      onDetailPosition(
                        "left",
                      )
                    }
                  >
                    Links andocken
                  </button>


                  <button
                    type="button"
                    className={
                      detailPosition === "right"
                        ? "checked-menu-button"
                        : ""
                    }
                    onClick={() =>
                      onDetailPosition(
                        "right",
                      )
                    }
                  >
                    Rechts andocken
                  </button>


                  <button
                    type="button"
                    disabled
                    title="Wird später umgesetzt"
                  >
                    Detailansicht lösen
                  </button>

                </div>

              </div>


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
