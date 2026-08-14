from __future__ import annotations

from typing import Any, Callable

from PySide6.QtCore import QItemSelectionModel, Qt, Signal, Slot
from PySide6.QtGui import QAction
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHeaderView,
    QMenu,
    QTableWidget,
    QTableWidgetItem,
)

from inventory import (
    DEFAULT_VISIBLE_COLUMNS,
    HEADER_LABELS,
    PREFERRED_COLUMN_ORDER,
    format_inventory_value,
)

AssetPredicate = Callable[[dict[str, Any] | None], bool]


class AssetTableWidget(QTableWidget):
    """Inventartabelle mit Spaltenmenü, Drag-Reihenfolge und Mehrfachauswahl."""

    counts_changed = Signal(int, int)
    visible_columns_changed = Signal()
    column_visibility_rejected = Signal(str)

    def __init__(
        self,
        columns_menu: QMenu | None = None,
        parent=None,
    ) -> None:
        super().__init__(parent)
        self.columns_menu = columns_menu
        self.current_columns: list[str] = []
        self.visible_columns: set[str] = set()
        self.column_actions: dict[str, QAction] = {}
        self.column_visibility_initialized = False
        self._configure_table()

    def _configure_table(self) -> None:
        self.setAlternatingRowColors(True)
        self.setSortingEnabled(True)
        self.setShowGrid(False)
        self.setWordWrap(False)
        self.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.setSelectionMode(
            QAbstractItemView.SelectionMode.ExtendedSelection
        )
        self.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOn
        )
        self.setVerticalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAsNeeded
        )
        self.setHorizontalScrollMode(
            QAbstractItemView.ScrollMode.ScrollPerPixel
        )
        self.horizontalScrollBar().setSingleStep(30)
        self.verticalHeader().setVisible(False)

        header = self.horizontalHeader()
        header.setObjectName("assetTableHeader")
        header.setHighlightSections(False)
        header.setStretchLastSection(False)
        header.setMinimumSectionSize(80)
        header.setSectionResizeMode(QHeaderView.ResizeMode.Interactive)

        # Spalten können direkt per Drag & Drop verschoben werden.
        header.setSectionsMovable(True)

        # Rechtsklick auf die Überschriften öffnet die Spaltenauswahl.
        header.setContextMenuPolicy(
            Qt.ContextMenuPolicy.CustomContextMenu
        )
        header.customContextMenuRequested.connect(
            self._show_header_context_menu
        )

    def populate_assets(
        self,
        assets: list[dict[str, Any]],
    ) -> None:
        state = self._capture_view_state()

        self.setSortingEnabled(False)
        self.clearContents()
        self.clearSelection()

        if not assets:
            self.clear_assets()
            return

        self.current_columns = self.determine_columns(assets)
        self.initialize_visible_columns()
        self.setColumnCount(len(self.current_columns))
        self.setRowCount(len(assets))
        self.setHorizontalHeaderLabels(
            [self.get_header_label(name) for name in self.current_columns]
        )

        for row_index, asset in enumerate(assets):
            for column_index, column_name in enumerate(self.current_columns):
                display_value = self.format_value(
                    column_name,
                    asset.get(column_name),
                )
                item = QTableWidgetItem(display_value)
                if column_index == 0:
                    item.setData(Qt.ItemDataRole.UserRole, asset)
                self.setItem(row_index, column_index, item)

        self.rebuild_columns_menu()
        self.apply_column_visibility()
        self._restore_visual_column_order(state["column_order"])
        self.setSortingEnabled(True)
        self.resize_visible_columns()
        self._restore_view_state(state)
        self.counts_changed.emit(len(assets), len(assets))

    @staticmethod
    def determine_columns(
        assets: list[dict[str, Any]],
    ) -> list[str]:
        """Zeigt nur die freigegebenen Hauptspalten.

        Spezifikationen bleiben im Asset-Datensatz erhalten, werden aber
        bewusst in der separaten Detailansicht dargestellt.
        """

        available = {
            column
            for asset in assets
            for column in asset
        }
        return [
            column
            for column in PREFERRED_COLUMN_ORDER
            if column in available
        ]

    def initialize_visible_columns(self) -> None:
        available = set(self.current_columns)
        if not self.column_visibility_initialized:
            self.visible_columns = DEFAULT_VISIBLE_COLUMNS & available
            if not self.visible_columns:
                self.visible_columns = set(self.current_columns[:5])
            self.column_visibility_initialized = True
            return

        self.visible_columns &= available
        if not self.visible_columns:
            self.visible_columns = set(self.current_columns[:5])

    def rebuild_columns_menu(self) -> None:
        if self.columns_menu is None:
            return

        self.columns_menu.clear()
        self.column_actions.clear()

        show_all = QAction("Alle einblenden", self)
        show_all.triggered.connect(self.show_all_columns)
        self.columns_menu.addAction(show_all)

        reset = QAction("Standardansicht", self)
        reset.triggered.connect(self.reset_visible_columns)
        self.columns_menu.addAction(reset)
        self.columns_menu.addSeparator()

        for column_name in self._columns_in_visual_order():
            action = QAction(self.get_header_label(column_name), self)
            action.setCheckable(True)
            action.setChecked(column_name in self.visible_columns)
            action.toggled.connect(
                lambda checked, name=column_name: self.set_column_visible(
                    name,
                    checked,
                )
            )
            self.columns_menu.addAction(action)
            self.column_actions[column_name] = action

    def _show_header_context_menu(self, position) -> None:
        if not self.current_columns:
            return

        menu = QMenu(self)
        menu.addAction("Alle einblenden", self.show_all_columns)
        menu.addAction("Standardansicht", self.reset_visible_columns)
        menu.addSeparator()

        for column_name in self._columns_in_visual_order():
            action = menu.addAction(self.get_header_label(column_name))
            action.setCheckable(True)
            action.setChecked(column_name in self.visible_columns)
            action.toggled.connect(
                lambda checked, name=column_name: self.set_column_visible(
                    name,
                    checked,
                )
            )

        menu.exec(self.horizontalHeader().mapToGlobal(position))

    def set_column_visible(
        self,
        column_name: str,
        visible: bool,
    ) -> bool:
        if visible:
            self.visible_columns.add(column_name)
        elif len(self.visible_columns) <= 1:
            action = self.column_actions.get(column_name)
            if action is not None:
                action.blockSignals(True)
                action.setChecked(True)
                action.blockSignals(False)
            self.column_visibility_rejected.emit(
                "Mindestens eine Spalte muss sichtbar bleiben."
            )
            return False
        else:
            self.visible_columns.discard(column_name)

        self.apply_column_visibility()
        self.sync_column_actions()
        self.resize_visible_columns()
        self.visible_columns_changed.emit()
        return True

    @Slot()
    def show_all_columns(self) -> None:
        self.visible_columns = set(self.current_columns)
        self.sync_column_actions()
        self.apply_column_visibility()
        self.resize_visible_columns()
        self.visible_columns_changed.emit()

    @Slot()
    def reset_visible_columns(self) -> None:
        available = set(self.current_columns)
        self.visible_columns = DEFAULT_VISIBLE_COLUMNS & available
        if not self.visible_columns:
            self.visible_columns = set(self.current_columns[:5])
        self.sync_column_actions()
        self.apply_column_visibility()
        self.resize_visible_columns()
        self.visible_columns_changed.emit()

    def sync_column_actions(self) -> None:
        for column_name, action in self.column_actions.items():
            action.blockSignals(True)
            action.setChecked(column_name in self.visible_columns)
            action.blockSignals(False)

    def apply_column_visibility(self) -> None:
        for index, column_name in enumerate(self.current_columns):
            self.setColumnHidden(
                index,
                column_name not in self.visible_columns,
            )

    def resize_visible_columns(self) -> None:
        self.resizeColumnsToContents()
        for index, column_name in enumerate(self.current_columns):
            if column_name not in self.visible_columns:
                continue
            width = self.columnWidth(index)
            self.setColumnWidth(index, max(115, min(width, 320)))
        self.updateGeometry()
        self.viewport().update()

    def clear_assets(self) -> None:
        self.setSortingEnabled(False)
        self.clearContents()
        self.setRowCount(0)
        self.setColumnCount(0)
        self.setSortingEnabled(True)
        self.current_columns = []
        self.column_actions.clear()
        if self.columns_menu is not None:
            self.columns_menu.clear()
        self.counts_changed.emit(0, 0)

    def get_asset_from_row(
        self,
        row_index: int,
    ) -> dict[str, Any] | None:
        if self.columnCount() == 0:
            return None
        item = self.item(row_index, 0)
        if item is None:
            return None
        asset = item.data(Qt.ItemDataRole.UserRole)
        return asset if isinstance(asset, dict) else None

    def get_selected_assets(self) -> list[dict[str, Any]]:
        model = self.selectionModel()
        if model is None:
            return []

        assets: list[dict[str, Any]] = []
        for index in sorted(model.selectedRows(), key=lambda item: item.row()):
            asset = self.get_asset_from_row(index.row())
            if asset is not None:
                assets.append(asset)
        return assets

    def get_selected_asset(self) -> dict[str, Any] | None:
        assets = self.get_selected_assets()
        return assets[0] if len(assets) == 1 else None

    def filter_rows(
        self,
        search_text: str = "",
        asset_predicate: AssetPredicate | None = None,
    ) -> tuple[int, int]:
        normalized_search = search_text.strip().casefold()
        total_count = self.rowCount()
        visible_count = 0

        for row_index in range(total_count):
            asset = self.get_asset_from_row(row_index)
            search_matches = (
                not normalized_search
                or self.row_matches_visible_columns(
                    row_index,
                    normalized_search,
                )
            )
            additional_matches = (
                asset_predicate(asset)
                if asset_predicate is not None
                else True
            )
            row_matches = search_matches and additional_matches
            self.setRowHidden(row_index, not row_matches)
            visible_count += int(row_matches)

        self.counts_changed.emit(visible_count, total_count)
        return visible_count, total_count

    def row_matches_visible_columns(
        self,
        row_index: int,
        search_text: str,
    ) -> bool:
        return any(
            item is not None
            and search_text in item.text().casefold()
            for column_index, column_name in enumerate(self.current_columns)
            if column_name in self.visible_columns
            for item in [self.item(row_index, column_index)]
        )

    def _columns_in_visual_order(self) -> list[str]:
        if not self.current_columns:
            return []
        header = self.horizontalHeader()
        return [
            self.current_columns[header.logicalIndex(visual_index)]
            for visual_index in range(header.count())
            if 0 <= header.logicalIndex(visual_index) < len(self.current_columns)
        ]

    def _capture_view_state(self) -> dict[str, Any]:
        selected_ids = {
            asset.get("id")
            for asset in self.get_selected_assets()
            if asset.get("id") is not None
        }
        return {
            "column_order": self._columns_in_visual_order(),
            "selected_ids": selected_ids,
            "horizontal_scroll": self.horizontalScrollBar().value(),
            "vertical_scroll": self.verticalScrollBar().value(),
        }

    def _restore_visual_column_order(self, old_order: list[str]) -> None:
        if not old_order or not self.current_columns:
            return

        desired = [name for name in old_order if name in self.current_columns]
        desired.extend(
            name
            for name in self.current_columns
            if name not in desired
        )

        header = self.horizontalHeader()
        for target_visual, column_name in enumerate(desired):
            logical = self.current_columns.index(column_name)
            current_visual = header.visualIndex(logical)
            if current_visual != target_visual:
                header.moveSection(current_visual, target_visual)

    def _restore_view_state(self, state: dict[str, Any]) -> None:
        selected_ids = state.get("selected_ids", set())
        selection_model = self.selectionModel()
        if selected_ids and selection_model is not None:
            for row in range(self.rowCount()):
                asset = self.get_asset_from_row(row)
                if asset is None or asset.get("id") not in selected_ids:
                    continue
                index = self.model().index(row, 0)
                selection_model.select(
                    index,
                    QItemSelectionModel.SelectionFlag.Select
                    | QItemSelectionModel.SelectionFlag.Rows,
                )

        self.horizontalScrollBar().setValue(
            int(state.get("horizontal_scroll", 0))
        )
        self.verticalScrollBar().setValue(
            int(state.get("vertical_scroll", 0))
        )

    @staticmethod
    def get_header_label(column_name: str) -> str:
        return HEADER_LABELS.get(
            column_name,
            column_name.replace("_", " ").strip().title(),
        )

    @staticmethod
    def format_value(column_name: str, value: Any) -> str:
        return format_inventory_value(column_name, value)