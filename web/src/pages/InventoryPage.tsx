import {
  Fragment,
  useCallback,
  useState,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import AboutDialog from "../components/AboutDialog";
import AssetDetailPanel from "../components/AssetDetailPanel";
import ArchiveReasonDialog from "../components/ArchiveReasonDialog";
import InventorySidebar from "../components/InventorySidebar";
import LoadingIndicator from "../components/LoadingIndicator";
import InventoryTable, { type InventorySort } from "../components/InventoryTable";
import InventoryDashboard from "../components/InventoryDashboard";
import MainMenu from "../components/MainMenu";
import QrWorkflowDialog from "../components/QrWorkflowDialog";
import InventoryOperationDialog from "../components/InventoryOperationDialog";
import EntryContextMenu from "../components/EntryContextMenu";
import useRowContextMenu from "../hooks/useRowContextMenu";
import useMediaQuery from "../hooks/useMediaQuery";
import useDocking from "../hooks/useDocking";
import useInventoryActions from "../hooks/useInventoryActions";
import useInventoryColumns from "../hooks/useInventoryColumns";
import useInventoryData from "../hooks/useInventoryData";
import useInventoryView, { useInventoryCriteria } from "../hooks/useInventoryView";
import type { DockPanelKind, InventoryRow } from "../types/inventory";
import {
  getIdentifier,
  getRowKey,
} from "../utils/inventory";

type AppRole =
  | "admin"
  | "user"
  | "viewer";

const workspaceTabs = [["inventory", "IT-Inventar"], ["dashboard", "Dashboard"]] as const;
type WorkspaceTab = typeof workspaceTabs[number][0];

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
  const location=useLocation();
  const [imageWarning,setImageWarning]=useState(typeof location.state?.imageWarning === "string" ? location.state.imageWarning : "");
  const compactLayout = useMediaQuery("(max-width: 980px), (max-width: 1100px) and (pointer: coarse)");
  const [mobileView, setMobileView] = useState<"inventory" | "navigation" | "detail">("inventory");
  const [inventorySort, setInventorySort] = useState<InventorySort>({ column: null, direction: "asc" });
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("inventory");
  const [qrOpen, setQrOpen] = useState(false);
  const [operation, setOperation] = useState<{ kind: "move" | "stock"; row: InventoryRow } | null>(null);
  const swipeStart = useRef<{ x: number; y: number; left?: boolean; right?: boolean } | null>(null);
  const tabs = ["navigation", "inventory", "detail"] as const;
  function switchTab(tab: typeof mobileView) { setMobileView(tab); }
  function swipeEnd(x: number, y: number) {
    const start = swipeStart.current; swipeStart.current = null;
    if (!compactLayout || !start) return;
    const dx = x - start.x, dy = y - start.y;
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if ((dx > 0 && start.left) || (dx < 0 && start.right)) return;
    const index = tabs.indexOf(mobileView);
    switchTab(tabs[Math.max(0, Math.min(2, index + (dx < 0 ? 1 : -1)))]);
  }

  const [
    status,
    setStatus,
  ] = useState("");

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

  const criteria = useInventoryCriteria(inventorySort);
  const data = useInventoryData({
    query: criteria.query,
    onStatus: setStatus,
    onUnauthorized: handleUnauthorized,
  });

  const columns = useInventoryColumns({
    email,
    meta: data.meta,
    onStatus: setStatus,
  });

  const view = useInventoryView({
    criteria,
    page: data.page,
    serverOptions: data.options,
    inventory: data.inventory,
    meta: data.meta,
    formatValue:
      columns.formatValue,
  });

  const rowContext = useRowContextMenu(row => {
    const key = getRowKey(row);
    if (!view.selectedKeys.has(key)) view.setSelectedKeys(new Set([key]));
  });
  const contextRow = rowContext.menu?.row;
  const contextRows = contextRow && !view.selectedKeys.has(getRowKey(contextRow)) ? [contextRow] : view.selectedRows;
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

  function editEntry(rows = view.selectedRows): void {
    if (!canEdit) { readOnlyNotice(); return; }
    if (rows.length === 1) {
      navigate(`/inventory/${encodeURIComponent(getRowKey(rows[0]))}/edit`);
    } else if (rows.length > 200) {
      setStatus("Bitte höchstens 200 Einträge gleichzeitig bearbeiten.");
    } else if (rows.length > 1) {
      navigate("/inventory/bulk-edit", { state: { rows, meta: data.meta } });
    }
  }

  function editProductModels(): void {
    if (canManageSettings) navigate("/settings?tab=product-models");
  }

  function switchWorkspaceTab(tab: WorkspaceTab): void {
    closeContext();
    setWorkspaceTab(tab);
  }

  const navigationPanel =
    (compactLayout || docking.navigationVisible) ? (
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
        onSearchChange={
          view.setSearch
        }
        onFiltersChange={
          view.setFilters
        }
        onCreate={createEntry}
        onEdit={() => editEntry()}
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
    (compactLayout || docking.detailVisible) ? (
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
          id={compactLayout ? `mobile-panel-${panel}` : undefined}
          role={compactLayout ? "tabpanel" : undefined}
          aria-labelledby={compactLayout ? `mobile-tab-${panel}` : undefined}
          className={
            docking.panelClassName(
              panel,
            )
          }
          onPointerDown={(
            event,
          ) =>
            !compactLayout && docking.beginDockPointer(
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
    <div className={`main-window${compactLayout ? " compact-inventory" : ""}`}>
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
        onScan={() => setQrOpen(true)}
        compactLayout={compactLayout}
        sort={inventorySort}
        onSort={setInventorySort}
        workspaceTabs={<div className="workspace-tabs" role="tablist" aria-label="Hauptansicht">
          {workspaceTabs.map(([tab, label]) => <button key={tab} id={`workspace-tab-${tab}`}
            type="button" role="tab" aria-selected={workspaceTab === tab} aria-controls={`workspace-panel-${tab}`}
            tabIndex={workspaceTab === tab ? 0 : -1}
            onClick={() => switchWorkspaceTab(tab)}
            onKeyDown={event => {
              const next = event.key === "Home" ? "inventory" : event.key === "End" ? "dashboard"
                : event.key === "ArrowLeft" || event.key === "ArrowRight"
                  ? (tab === "inventory" ? "dashboard" : "inventory") : null;
              if (!next) return;
              event.preventDefault();
              switchWorkspaceTab(next);
              document.getElementById(`workspace-tab-${next}`)?.focus();
            }}>{label}</button>)}
        </div>}
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
        onExportCsvTables={() => void actions.exportCsvTables()}
        onExportExcel={() => void actions.exportExcel()}
        onExportPostgresql={() =>
          void actions.exportPostgresql()
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
        onArchive={() => navigate("/archive")}
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

      <section className="inventory-workspace-panel" id="workspace-panel-inventory" role="tabpanel"
        aria-labelledby="workspace-tab-inventory" hidden={workspaceTab !== "inventory"}>
      {compactLayout && <nav className="mobile-inventory-toolbar" aria-label="Inventaransicht">
        <div role="tablist" aria-label="Inventarbereiche" onPointerDown={event => { if (event.pointerType !== "mouse") swipeStart.current = { x: event.clientX, y: event.clientY }; }}
          onPointerUp={event => swipeEnd(event.clientX, event.clientY)} onPointerCancel={() => { swipeStart.current = null; }}>
          {tabs.map(tab => <button key={tab} id={`mobile-tab-${tab}`} role="tab" type="button" aria-selected={mobileView === tab}
            aria-controls={`mobile-panel-${tab}`} tabIndex={mobileView === tab ? 0 : -1} onClick={() => switchTab(tab)}
            onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault(); const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3];
              switchTab(next); document.getElementById(`mobile-tab-${next}`)?.focus();
            } }}>{tab === "navigation" ? "Filter" : tab === "inventory" ? "Tabelle" : "Details"}</button>)}
        </div>
        {mobileView === "inventory" && <input className="compact-inventory-search" type="search"
          aria-label="Inventar durchsuchen" placeholder="Inventar durchsuchen …" value={view.search}
          onChange={event => view.setSearch(event.target.value)} />}
        {canEdit && <button className="compact-create-button" type="button" onClick={createEntry} aria-label="+ Neuer Artikel" title="Neuer Artikel">+ Neu</button>}
      </nav>}

      {imageWarning && <div className="inventory-image-warning" role="alert">{imageWarning}<button onClick={()=>{setImageWarning("");navigate("/inventory",{replace:true,state:null});}}>Schliessen</button></div>}
      <div
        className="workspace"
        ref={workspaceRef}
        data-mobile-view={mobileView}
        onTouchStart={event => {
          swipeStart.current = null;
          if (!compactLayout || event.touches.length !== 1 || (event.target as Element).closest("input,select,textarea,button")) return;
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

        <main className="inventory-area" id={compactLayout ? "mobile-panel-inventory" : undefined} role={compactLayout ? "tabpanel" : undefined} aria-labelledby={compactLayout ? "mobile-tab-inventory" : undefined}>
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
            sort={inventorySort}
            onSort={setInventorySort}
            rows={view.filteredRows}
            serverPaged={data.page?.legacy === false}
            hasNextPage={data.page != null && data.page.next_offset !== null}
            loadingMore={data.loadingMore}
            loadMoreError={data.moreError}
            onLoadMore={data.loadMore}
            queryKey={criteria.query}
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
      <div className="inventory-status" role="status">{status || (typeof location.state?.inventoryNotice === "string" ? location.state.inventoryNotice : "")}</div>
      </section>
      <section className="dashboard-panel" id="workspace-panel-dashboard" role="tabpanel"
        aria-labelledby="workspace-tab-dashboard" hidden={workspaceTab !== "dashboard"}>
        {workspaceTab === "dashboard" && <InventoryDashboard refreshVersion={data.refreshVersion} onUnauthorized={handleUnauthorized} />}
      </section>

      <AboutDialog
        open={aboutOpen}
        onClose={() =>
          setAboutOpen(false)
        }
      />

      {actions.archiveKeys && <ArchiveReasonDialog count={actions.archiveKeys.length} busy={actions.deleteBusy}
        error={actions.archiveError} onCancel={actions.cancelArchive} onConfirm={reason => void actions.confirmArchive(reason)} />}
      {qrOpen && <QrWorkflowDialog canEdit={canEdit} onClose={() => setQrOpen(false)}
        onArchive={key => { setQrOpen(false); actions.archiveEntries([key]); }}
        onCreate={(code, type, format) => { setQrOpen(false); navigate(`/inventory/new?code=${encodeURIComponent(code)}&code_type=${type}&code_format=${encodeURIComponent(format)}`); }}
        onEdit={(key) => { setQrOpen(false); navigate(`/inventory/${encodeURIComponent(key)}/edit`); }}
        onChanged={data.loadData} />}

      {rowContext.menu && contextRow && <EntryContextMenu x={rowContext.menu.x} y={rowContext.menu.y} disabled={!canEdit || loading}
        multiple={contextRows.length > 1} onClose={closeContext} onEdit={() => editEntry(contextRows)}
        onDuplicate={contextRows.length === 1 ? () => navigate(`/inventory/new?duplicate=${encodeURIComponent(getRowKey(contextRow))}`) : undefined}
        onMove={contextRows.length === 1 ? () => setOperation({ kind: "move", row: contextRow }) : undefined}
        onChangeStock={contextRows.length === 1 && contextRow._record_type === "stock" ? () => setOperation({ kind: "stock", row: contextRow }) : undefined}
        onDelete={() => void actions.deleteEntries(contextRows)} />}
      {operation && <InventoryOperationDialog kind={operation.kind} row={operation.row}
        onCancel={() => setOperation(null)} onUnauthorized={handleUnauthorized}
        onSuccess={async message => {
          setOperation(null);
          await data.loadData();
          setStatus(message);
        }} />}

      <div className="status-bar">
        <span>
          {workspaceTab === "dashboard" ? "Standortübersicht" : view.countText}
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
