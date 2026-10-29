import {
  Fragment,
  useCallback,
  useState,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import AboutDialog from "../components/AboutDialog";
import AssetDetailPanel from "../components/AssetDetailPanel";
import InventorySidebar from "../components/InventorySidebar";
import LoadingIndicator from "../components/LoadingIndicator";
import InventoryTable from "../components/InventoryTable";
import MainMenu from "../components/MainMenu";
import QrWorkflowDialog from "../components/QrWorkflowDialog";
import EntryContextMenu from "../components/EntryContextMenu";
import useRowContextMenu from "../hooks/useRowContextMenu";
import useMediaQuery from "../hooks/useMediaQuery";
import useDocking from "../hooks/useDocking";
import useInventoryActions from "../hooks/useInventoryActions";
import useInventoryColumns from "../hooks/useInventoryColumns";
import useInventoryData from "../hooks/useInventoryData";
import useInventoryView from "../hooks/useInventoryView";
import type { DockPanelKind } from "../types/inventory";
import {
  getIdentifier,
  getRowKey,
} from "../utils/inventory";

type AppRole =
  | "admin"
  | "user"
  | "viewer";

type InventoryPageProps = {
  email: string;
  role: AppRole;
  onLogout: () => void;
};

export default function InventoryPage({
  email,
  role,
  onLogout,
}: InventoryPageProps) {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 720px) and (orientation: portrait) and (pointer: coarse)");
  const [mobileView, setMobileView] = useState<"inventory" | "navigation" | "detail">("inventory");
  const [qrOpen, setQrOpen] = useState(false);
  const swipeStart = useRef<{ x: number; y: number; left?: boolean; right?: boolean } | null>(null);
  const tabs = ["navigation", "inventory", "detail"] as const;
  function switchTab(tab: typeof mobileView) { setMobileView(tab); }
  function swipeEnd(x: number, y: number) {
    const start = swipeStart.current; swipeStart.current = null;
    if (!isMobile || !start) return;
    const dx = x - start.x, dy = y - start.y;
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if ((dx > 0 && start.left) || (dx < 0 && start.right)) return;
    const index = tabs.indexOf(mobileView);
    switchTab(tabs[Math.max(0, Math.min(2, index + (dx < 0 ? 1 : -1)))]);
  }

  const [
    status,
    setStatus,
  ] = useState(
    "Inventardaten werden geladen ...",
  );

  const [
    aboutOpen,
    setAboutOpen,
  ] = useState(false);

  const handleUnauthorized =
    useCallback(
      (): void => {
        onLogout();
        navigate(
          "/login",
          {
            replace: true,
          },
        );
      },
      [
        navigate,
        onLogout,
      ],
    );

  const data = useInventoryData({
    onStatus: setStatus,
    onUnauthorized: handleUnauthorized,
  });

  const columns = useInventoryColumns({
    email,
    inventory: data.inventory,
    meta: data.meta,
    onStatus: setStatus,
  });

  const view = useInventoryView({
    inventory: data.inventory,
    meta: data.meta,
    displayedColumns:
      columns.displayedColumns,
    formatValue:
      columns.formatValue,
  });

  const rowContext = useRowContextMenu(row => view.setSelectedKeys(new Set([getRowKey(row)])));
  const closeContext = rowContext.close;

  const handleLoggedOut =
    useCallback(
      (): void => {
        onLogout();
        navigate(
          "/login",
          {
            replace: true,
          },
        );
      },
      [
        navigate,
        onLogout,
      ],
    );

  const { csvFileInputRef, ...actions } = useInventoryActions({
    selectedRows: view.selectedRows,
    dataLoading: data.loading,
    onStatus: setStatus,
    onUnauthorized:
      handleUnauthorized,
    onLoggedOut:
      handleLoggedOut,
    reload:
      data.loadData,
    clearSelection:
      view.clearSelection,
  });

  const { workspaceRef, ...docking } = useDocking({
    onStatus: setStatus,
  });

  const loading =
    data.loading ||
    actions.deleteBusy;

  const canEdit =
    role === "admin" ||
    role === "user";

  const canManageSettings =
    role === "admin";

  function readOnlyNotice(): void {
    window.alert(
      "Dieses Benutzerkonto besitzt nur Leserechte.",
    );
  }

  function createEntry(): void {
    if (!canEdit) {
      readOnlyNotice();
      return;
    }

    navigate("/inventory/new");
  }

  function editEntry(): void {
    if (!canEdit) {
      readOnlyNotice();
      return;
    }

    if (
      view.selectedRows.length !== 1
    ) {
      return;
    }

    navigate(
      `/inventory/${encodeURIComponent(
        getRowKey(
          view.selectedRows[0],
        ),
      )}/edit`,
    );
  }

  function editProductModels(): void {
    if (canManageSettings) navigate("/settings?tab=product-models");
  }

  const navigationPanel =
    (isMobile || docking.navigationVisible) ? (
      <InventorySidebar
        search={view.search}
        filters={view.filters}
        options={
          view.filterOptions
        }
        loading={loading}
        canManageProductModels={canManageSettings}
        selectedIdentifiers={
          view.selectedIdentifiers
        }
        countText={view.countText}
        onSearchChange={
          view.setSearch
        }
        onFiltersChange={
          view.setFilters
        }
        onCreate={createEntry}
        onEdit={editEntry}
        onProductModels={editProductModels}
        onDelete={() => {
          if (!canEdit) {
            readOnlyNotice();
            return;
          }

          void actions.deleteEntries();
        }}
      />
    ) : null;

  const detailPanel =
    (isMobile || docking.detailVisible) ? (
      <AssetDetailPanel
        rows={view.selectedRows}
        getIdentifier={
          getIdentifier
        }
        getHeaderLabel={
          columns.getHeaderLabel
        }
        formatValue={
          columns.formatValue
        }
      />
    ) : null;

  function panelContent(
    panel: DockPanelKind,
  ): ReactNode {
    return panel === "navigation"
      ? navigationPanel
      : detailPanel;
  }

  function renderDockPanel(
    panel: DockPanelKind,
    side: "left" | "right",
  ) {
    const content =
      panelContent(panel);

    if (!content) {
      return null;
    }

    return (
      <Fragment
        key={`${side}-${panel}`}
      >
        <div
          ref={
            docking.panelRef(panel)
          }
          data-dock-panel={panel}
          id={isMobile ? `mobile-panel-${panel}` : undefined}
          role={isMobile ? "tabpanel" : undefined}
          aria-labelledby={isMobile ? `mobile-tab-${panel}` : undefined}
          className={
            docking.panelClassName(
              panel,
            )
          }
          onPointerDown={(
            event,
          ) =>
            !isMobile && docking.beginDockPointer(
              panel,
              event,
            )
          }
        >
          {content}
        </div>
      </Fragment>
    );
  }

  return (
    <div className={`main-window${isMobile ? " mobile-portrait" : ""}`}>
      <input
        ref={
          csvFileInputRef
        }
        className="hidden-file-input"
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => {
          const file =
            event.target.files?.[0];

          if (file) {
            void actions.importCsvFile(
              file,
            );
          }
        }}
      />

      <MainMenu
        navigationVisible={
          docking.navigationVisible
        }
        detailVisible={
          docking.detailVisible
        }
        navigationPosition={
          docking.navigationPosition
        }
        detailPosition={
          docking.detailPosition
        }
        columns={
          columns.availableColumns
        }
        visibleColumns={
          columns.visibleColumns
        }
        transferBusy={
          actions.transferBusy
        }
        canManageSettings={
          canManageSettings
        }
        getHeaderLabel={
          columns.getHeaderLabel
        }
        onRefresh={() =>
          void data.loadData()
        }
        onImportCsv={
          canManageSettings
            ? actions.chooseCsvImport
            : readOnlyNotice
        }
        onExportCsv={() =>
          void actions.exportCsv()
        }
        onSettings={() => {
          if (
            canManageSettings
          ) {
            navigate(
              "/settings",
            );
          }
        }}
        onAbout={() =>
          setAboutOpen(true)
        }
        onLogout={() =>
          void actions.logout()
        }
        onStatus={setStatus}
        onNavigationVisible={
          docking.setNavigationVisible
        }
        onDetailVisible={
          docking.setDetailVisible
        }
        onNavigationPosition={(
          position,
        ) =>
          docking.dockPanelAtEdge(
            "navigation",
            position,
          )
        }
        onDetailPosition={(
          position,
        ) =>
          docking.dockPanelAtEdge(
            "detail",
            position,
          )
        }
        onColumnVisible={
          columns.setColumnVisible
        }
        onShowAllColumns={
          columns.showAllColumns
        }
        onResetColumns={
          columns.resetColumns
        }
      />

      {isMobile && <nav className="mobile-inventory-toolbar" aria-label="Mobile Inventaransicht">
        <div role="tablist" aria-label="Inventarbereiche" onPointerDown={event => { if (event.pointerType !== "mouse") swipeStart.current = { x: event.clientX, y: event.clientY }; }}
          onPointerUp={event => swipeEnd(event.clientX, event.clientY)} onPointerCancel={() => { swipeStart.current = null; }}>
          {tabs.map(tab => <button key={tab} id={`mobile-tab-${tab}`} role="tab" type="button" aria-selected={mobileView === tab}
            aria-controls={`mobile-panel-${tab}`} tabIndex={mobileView === tab ? 0 : -1} onClick={() => switchTab(tab)}
            onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault(); const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3];
              switchTab(next); document.getElementById(`mobile-tab-${next}`)?.focus();
            } }}>{tab === "navigation" ? "Filter" : tab === "inventory" ? "Tabelle" : "Details"}</button>)}
        </div>
        <button type="button" className="primary-button" onClick={() => setQrOpen(true)}>Scanner</button>
      </nav>}

      <div
        className="workspace"
        ref={workspaceRef}
        data-mobile-view={mobileView}
        onTouchStart={event => {
          swipeStart.current = null;
          if (!isMobile || event.touches.length !== 1 || (event.target as Element).closest("input,select,textarea,button")) return;
          const touch = event.touches[0];
          const table = (event.target as Element).closest(".table-wrapper");
          swipeStart.current = { x: touch.clientX, y: touch.clientY,
            left: !!table && table.scrollLeft > 2,
            right: !!table && table.scrollLeft + table.clientWidth < table.scrollWidth - 2 };
        }}
        onTouchEnd={event => { const touch = event.changedTouches[0]; if (touch) swipeEnd(touch.clientX, touch.clientY); }}
        onTouchCancel={() => { swipeStart.current = null; }}
      >
        {docking.dockDrag && (
          <>
            <div
              className={[
                "dock-drop-zone",
                "dock-drop-zone-left",
                docking.dockDrag
                  .target ===
                "left-edge"
                  ? "active"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              Ganz links andocken
            </div>

            <div
              className={[
                "dock-drop-zone",
                "dock-drop-zone-right",
                docking.dockDrag
                  .target ===
                "right-edge"
                  ? "active"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              Ganz rechts andocken
            </div>
          </>
        )}

        {docking.dockOrder
          .filter(
            (panel) =>
              docking.panelPosition(
                panel,
              ) === "left",
          )
          .map((panel) =>
            renderDockPanel(
              panel,
              "left",
            ),
          )}

        <main className="inventory-area" id={isMobile ? "mobile-panel-inventory" : undefined} role={isMobile ? "tabpanel" : undefined} aria-labelledby={isMobile ? "mobile-tab-inventory" : undefined}>
          <div className="page-header">
            <h1>IT-Inventar</h1>
            <div className="inventory-header-actions">
              <button type="button" className="primary-button desktop-qr-button" onClick={() => setQrOpen(true)}>Scanner</button>
              {isMobile && canEdit && <button type="button" onClick={createEntry}>+ Neuer Artikel</button>}
            </div>
          </div>

          {data.loadError && (
            <div className="inventory-load-error" role="alert">
              <span>{data.loadError}</span>
              <button type="button" disabled={data.loading} onClick={() => void data.loadData()}>
                Erneut laden
              </button>
            </div>
          )}
          {!data.meta && !data.loadError ? (
            <LoadingIndicator />
          ) : <InventoryTable
            rows={view.filteredRows}
            rowBindings={rowContext.bind}
            columns={
              columns.displayedColumns
            }
            allColumns={
              columns.availableColumns
            }
            visibleColumns={
              columns.visibleColumns
            }
            selectedKeys={
              view.selectedKeys
            }
            loading={loading}
            getRowKey={getRowKey}
            getHeaderLabel={
              columns.getHeaderLabel
            }
            formatValue={
              columns.formatValue
            }
            onSelectionChange={
              view.setSelectedKeys
            }
            onMoveColumn={
              columns.moveColumn
            }
            onColumnVisible={
              columns.setColumnVisible
            }
            onShowAllColumns={
              columns.showAllColumns
            }
            onResetColumns={
              columns.resetColumns
            }
          />}
          <div className="inventory-status" role="status">{status}</div>
        </main>

        {docking.dockOrder
          .filter(
            (panel) =>
              docking.panelPosition(
                panel,
              ) === "right",
          )
          .map((panel) =>
            renderDockPanel(
              panel,
              "right",
            ),
          )}
      </div>

      <AboutDialog
        open={aboutOpen}
        onClose={() =>
          setAboutOpen(false)
        }
      />

      {qrOpen && <QrWorkflowDialog canEdit={canEdit} onClose={() => setQrOpen(false)}
        onCreate={(code, type, format) => { setQrOpen(false); navigate(`/inventory/new?code=${encodeURIComponent(code)}&code_type=${type}&code_format=${encodeURIComponent(format)}`); }}
        onEdit={(key) => { setQrOpen(false); navigate(`/inventory/${encodeURIComponent(key)}/edit`); }}
        onChanged={data.loadData} />}

      {rowContext.menu && <EntryContextMenu x={rowContext.menu.x} y={rowContext.menu.y} disabled={!canEdit || loading}
        onClose={closeContext} onEdit={() => navigate(`/inventory/${encodeURIComponent(getRowKey(rowContext.menu!.row))}/edit`)}
        onDelete={() => void actions.deleteEntries([rowContext.menu!.row])} />}

      <div className="status-bar">
        <span>
          {view.countText}
        </span>

        <span
          className="status-user"
          title={
            `Angemeldet als ${email}`
          }
        >
          Angemeldet: {email}
        </span>
      </div>
    </div>
  );
}
