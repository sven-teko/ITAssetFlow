export type InventoryRow = Record<string, unknown>;

export type InventoryMeta = {
  column_order: string[];
  default_visible_columns: string[];
  headers: Record<string, string>;
  status_labels: Record<string, string>;
  condition_labels: Record<string, string>;
  inventory_group_labels: Record<string, string>;
};

export type DockPanelKind = "navigation" | "detail";

export type DockDropTarget =
  | "left-edge"
  | "right-edge"
  | "before-navigation"
  | "after-navigation"
  | "before-detail"
  | "after-detail";

export type DockDragState = {
  panel: DockPanelKind;
  target: DockDropTarget | null;
};

export type DeleteInventoryResult = {
  deleted_count?: unknown;
  asset_count?: unknown;
  stock_count?: unknown;
};

export type CsvImportResult = {
  imported_rows?: unknown;
  table_count?: unknown;
};
