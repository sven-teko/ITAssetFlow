import {
  Fragment,
  useCallback,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import AboutDialog from "../components/AboutDialog";
import AssetDetailPanel from "../components/AssetDetailPanel";
import InventorySidebar from "../components/InventorySidebar";
import InventoryTable from "../components/InventoryTable";
import MainMenu from "../components/MainMenu";
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

  const [
    ,
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

  const actions = useInventoryActions({
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

  const docking = useDocking({
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
    docking.navigationVisible ? (
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
    docking.detailVisible ? (
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
          className={
            docking.panelClassName(
              panel,
            )
          }
          onPointerDown={(
            event,
          ) =>
            docking.beginDockPointer(
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
    <div className="main-window">
      <input
        ref={
          actions.csvFileInputRef
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

      <div
        className="workspace"
        ref={docking.workspaceRef}
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

        <main className="inventory-area">
          <div className="page-header">
            <h1>IT-Inventar</h1>
            <span>
              {view.countText}
            </span>
          </div>

          <InventoryTable
            rows={view.filteredRows}
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
          />
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
