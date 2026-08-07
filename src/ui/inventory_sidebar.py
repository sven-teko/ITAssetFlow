from __future__ import annotations

from typing import Any, Iterable

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QCheckBox,
    QDockWidget,
    QLabel,
    QLineEdit,
    QMenu,
    QPushButton,
    QVBoxLayout,
    QWidget,
    QWidgetAction,
)

from inventory import (
    INVENTORY_GROUP_LABELS,
    get_category_key,
    get_category_label,
    get_inventory_group,
)


class MultiSelectDropdown(QWidget):
    """Kompaktes Dropdown mit mehreren auswählbaren Checkbox-Einträgen.

    Keine Auswahl bedeutet bewusst: kein Filter / alle anzeigen.
    """

    selection_changed = Signal()

    def __init__(
        self,
        all_text: str,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.all_text = all_text
        self._checkboxes: dict[str, QCheckBox] = {}
        self._labels: dict[str, str] = {}

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self.button = QPushButton(all_text)
        self.button.setObjectName("filterDropdownButton")
        self.menu = QMenu(self.button)
        self.button.setMenu(self.menu)
        layout.addWidget(self.button)

    @property
    def selected_keys(self) -> set[str]:
        return {
            key
            for key, checkbox in self._checkboxes.items()
            if checkbox.isChecked()
        }

    def set_options(
        self,
        options: Iterable[tuple[str, str]],
        *,
        preserve_selection: bool = True,
    ) -> None:
        previous = self.selected_keys if preserve_selection else set()
        self.menu.clear()
        self._checkboxes.clear()
        self._labels.clear()

        reset_action = self.menu.addAction("Alle anzeigen")
        reset_action.triggered.connect(self.clear_selection)
        self.menu.addSeparator()

        for key, label in options:
            normalized_key = str(key).strip().casefold()
            checkbox = QCheckBox(label)
            checkbox.setChecked(normalized_key in previous)
            checkbox.toggled.connect(self._selection_toggled)

            widget_action = QWidgetAction(self.menu)
            widget_action.setDefaultWidget(checkbox)
            self.menu.addAction(widget_action)

            self._checkboxes[normalized_key] = checkbox
            self._labels[normalized_key] = label

        self._update_button_text()

    def clear_selection(self) -> None:
        changed = False
        for checkbox in self._checkboxes.values():
            if checkbox.isChecked():
                checkbox.blockSignals(True)
                checkbox.setChecked(False)
                checkbox.blockSignals(False)
                changed = True
        self._update_button_text()
        if changed:
            self.selection_changed.emit()

    def _selection_toggled(self, _checked: bool) -> None:
        self._update_button_text()
        self.selection_changed.emit()

    def _update_button_text(self) -> None:
        selected = self.selected_keys
        if not selected:
            self.button.setText(self.all_text)
            return

        labels = [
            self._labels[key]
            for key in self._labels
            if key in selected
        ]
        if len(labels) == 1:
            self.button.setText(labels[0])
        elif len(labels) == 2:
            self.button.setText(" · ".join(labels))
        else:
            self.button.setText(f"{len(labels)} ausgewählt")


class InventorySidebar(QDockWidget):
    """Navigation mit Suche, kompakten Mehrfachfiltern und Asset-Aktionen."""

    filter_changed = Signal()
    create_requested = Signal()
    edit_requested = Signal()
    delete_requested = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__("Navigation", parent)
        self._build_ui()
        self._connect_signals()

    def _build_ui(self) -> None:
        self.setObjectName("navigationSidebar")
        self.setAllowedAreas(
            Qt.DockWidgetArea.LeftDockWidgetArea
            | Qt.DockWidgetArea.RightDockWidgetArea
        )
        self.setFeatures(
            QDockWidget.DockWidgetFeature.DockWidgetMovable
            | QDockWidget.DockWidgetFeature.DockWidgetFloatable
        )
        self.setMinimumWidth(260)

        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        search_title = QLabel("Inventar durchsuchen")
        search_title.setObjectName("sidebarTitle")
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText(
            "Alle sichtbaren Spalten durchsuchen ..."
        )
        self.search_input.setClearButtonEnabled(True)

        type_title = QLabel("Inventartyp")
        type_title.setObjectName("sidebarTitle")
        self.group_dropdown = MultiSelectDropdown("Alle Inventartypen")
        self.group_dropdown.set_options(
            (key, label)
            for key, label in INVENTORY_GROUP_LABELS.items()
        )

        category_title = QLabel("Produktkategorien")
        category_title.setObjectName("sidebarTitle")
        self.category_dropdown = MultiSelectDropdown(
            "Alle Produktkategorien"
        )
        self.category_dropdown.setEnabled(False)
        self.category_dropdown.button.setText(
            "Kategorien werden geladen ..."
        )

        action_title = QLabel("Inventar")
        action_title.setObjectName("sidebarTitle")
        self.create_button = QPushButton("Neues Asset")
        self.edit_button = QPushButton("Asset bearbeiten")
        self.delete_button = QPushButton("Assets löschen")
        self.edit_button.setEnabled(False)
        self.delete_button.setEnabled(False)

        selection_title = QLabel("Auswahl")
        selection_title.setObjectName("sidebarTitle")
        self.selection_label = QLabel("Kein Asset ausgewählt")
        self.selection_label.setObjectName("selectionLabel")
        self.selection_label.setWordWrap(True)
        self.count_label = QLabel("0 Datensätze")
        self.count_label.setObjectName("sidebarCountLabel")

        layout.addWidget(search_title)
        layout.addWidget(self.search_input)
        layout.addSpacing(4)
        layout.addWidget(type_title)
        layout.addWidget(self.group_dropdown)
        layout.addWidget(category_title)
        layout.addWidget(self.category_dropdown)
        layout.addSpacing(8)
        layout.addWidget(action_title)
        layout.addWidget(self.create_button)
        layout.addWidget(self.edit_button)
        layout.addWidget(self.delete_button)
        layout.addStretch()
        layout.addWidget(selection_title)
        layout.addWidget(self.selection_label)
        layout.addWidget(self.count_label)
        self.setWidget(content)

    def _connect_signals(self) -> None:
        self.search_input.textChanged.connect(
            lambda _text: self.filter_changed.emit()
        )
        self.group_dropdown.selection_changed.connect(
            self.filter_changed.emit
        )
        self.category_dropdown.selection_changed.connect(
            self.filter_changed.emit
        )
        self.create_button.clicked.connect(
            lambda _checked=False: self.create_requested.emit()
        )
        self.edit_button.clicked.connect(
            lambda _checked=False: self.edit_requested.emit()
        )
        self.delete_button.clicked.connect(
            lambda _checked=False: self.delete_requested.emit()
        )

    @property
    def search_text(self) -> str:
        return self.search_input.text()

    def matches(self, asset: dict[str, Any] | None) -> bool:
        return self.matches_group(asset) and self.matches_category(asset)

    def matches_group(self, asset: dict[str, Any] | None) -> bool:
        selected = self.group_dropdown.selected_keys
        if not selected:
            return True
        if asset is None:
            return False
        return get_inventory_group(asset) in selected

    def matches_category(self, asset: dict[str, Any] | None) -> bool:
        selected = self.category_dropdown.selected_keys
        if not selected:
            return True
        if asset is None:
            return False
        category_key = get_category_key(asset)
        return category_key is not None and category_key in selected

    def rebuild_category_filter(
        self,
        assets: list[dict[str, Any]],
        category_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        categories: dict[str, str] = {}

        for category in category_rows or []:
            normalized = {
                f"product_category_{key}": value
                for key, value in category.items()
            }
            key = get_category_key(normalized)
            if key is not None:
                categories[key] = get_category_label(normalized)

        if not categories:
            for asset in assets:
                key = get_category_key(asset)
                if key is not None:
                    categories[key] = get_category_label(asset)

        if not categories:
            self.category_dropdown.set_options([])
            self.category_dropdown.setEnabled(False)
            self.category_dropdown.button.setText(
                "Keine Produktkategorien verfügbar"
            )
            self.category_dropdown.button.setToolTip(
                "Prüfe SELECT-Rechte/RLS für product_categories."
            )
            return

        self.category_dropdown.setEnabled(True)
        self.category_dropdown.button.setToolTip("")
        self.category_dropdown.set_options(
            sorted(
                categories.items(),
                key=lambda item: item[1].casefold(),
            ),
            preserve_selection=True,
        )

    def set_loading_state(self, is_loading: bool) -> None:
        # Suche und Filter bleiben während des Ladens bedienbar.
        # Schreibaktionen werden vorsichtshalber gesperrt.
        self.create_button.setEnabled(not is_loading)
        if is_loading:
            self.edit_button.setEnabled(False)
            self.delete_button.setEnabled(False)

    def set_selection(self, identifiers: list[str]) -> None:
        count = len(identifiers)
        if count == 0:
            self.selection_label.setText("Kein Asset ausgewählt")
            self.edit_button.setEnabled(False)
            self.delete_button.setEnabled(False)
        elif count == 1:
            self.selection_label.setText(
                f"Ausgewähltes Asset:\n{identifiers[0]}"
            )
            self.edit_button.setEnabled(True)
            self.delete_button.setEnabled(True)
        else:
            self.selection_label.setText(f"{count} Assets ausgewählt")
            self.edit_button.setEnabled(False)
            self.delete_button.setEnabled(True)

    def set_count_text(self, text: str) -> None:
        self.count_label.setText(text)