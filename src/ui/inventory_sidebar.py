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
    get_condition_key,
    get_condition_label,
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
            checkbox.setObjectName("filterOption")
            checkbox.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
            checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
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
        self._is_loading = False
        self._selection_count = 0
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
        self.setMinimumWidth(300)

        content = QWidget()
        content.setObjectName("navigationContent")
        layout = QVBoxLayout(content)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)

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
        self.group_dropdown.set_options([])
        self.group_dropdown.setEnabled(False)
        self.group_dropdown.button.setText("Inventartypen werden geladen ...")

        category_title = QLabel("Kategorien")
        category_title.setObjectName("sidebarTitle")
        self.category_dropdown = MultiSelectDropdown(
            "Alle Kategorien"
        )
        self.category_dropdown.setEnabled(False)
        self.category_dropdown.button.setText(
            "Kategorien werden geladen ..."
        )

        condition_title = QLabel("Zustand")
        condition_title.setObjectName("sidebarTitle")
        self.condition_dropdown = MultiSelectDropdown(
            "Alle Zustände"
        )
        self.condition_dropdown.setEnabled(False)
        self.condition_dropdown.button.setText(
            "Zustände werden geladen ..."
        )

        action_title = QLabel("Inventar")
        action_title.setObjectName("sidebarTitle")
        self.create_button = QPushButton("Neuer Eintrag")
        self.edit_button = QPushButton("Eintrag bearbeiten")
        self.delete_button = QPushButton("Einträge löschen")
        self.edit_button.setEnabled(False)
        self.delete_button.setEnabled(False)

        selection_title = QLabel("Auswahl")
        selection_title.setObjectName("sidebarTitle")
        self.selection_label = QLabel("Kein Eintrag ausgewählt")
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
        layout.addWidget(condition_title)
        layout.addWidget(self.condition_dropdown)
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
        self.condition_dropdown.selection_changed.connect(
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
        return (
            self.matches_group(asset)
            and self.matches_category(asset)
            and self.matches_condition(asset)
        )

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

    def matches_condition(self, asset: dict[str, Any] | None) -> bool:
        selected = self.condition_dropdown.selected_keys
        if not selected:
            return True
        if asset is None:
            return False

        condition_key = get_condition_key(asset)
        return condition_key is not None and condition_key in selected

    def rebuild_filters(
        self,
        assets: list[dict[str, Any]],
    ) -> None:
        """Baut Inventartyp- und Kategorie-Filter nur aus sichtbaren Asset-Daten.

        Dadurch enthalten die Filter keine Kategorien, die in der aktuellen
        Asset-Tabelle gar nicht vorkommen. Kategoriebezeichnungen stammen aus
        derselben Mapping-Funktion wie die Tabellenanzeige.
        """


        groups: dict[str, str] = {}
        categories: dict[str, str] = {}
        conditions: dict[str, str] = {}

        for asset in assets:
            group_key = get_inventory_group(asset)
            group_label = INVENTORY_GROUP_LABELS.get(
                group_key,
                group_key.replace("_", " ").title(),
            )
            groups[group_key] = group_label

            category_key = get_category_key(asset)
            if category_key is not None:
                categories[category_key] = get_category_label(asset)

            condition_key = get_condition_key(asset)
            if condition_key is not None:
                conditions[condition_key] = get_condition_label(asset)

        if groups:
            self.group_dropdown.setEnabled(True)
            self.group_dropdown.button.setToolTip("")
            self.group_dropdown.set_options(
                sorted(
                    groups.items(),
                    key=lambda item: item[1].casefold(),
                ),
                preserve_selection=True,
            )
        else:
            self.group_dropdown.set_options([])
            self.group_dropdown.setEnabled(False)
            self.group_dropdown.button.setText("Keine Inventartypen verfügbar")

        if not categories:
            self.category_dropdown.set_options([])
            self.category_dropdown.setEnabled(False)
            self.category_dropdown.button.setText(
                "Keine Kategorien verfügbar"
            )
            self.category_dropdown.button.setToolTip(
                "In der aktuellen Inventartabelle sind keine Kategorien vorhanden."
            )
        else:
            self.category_dropdown.setEnabled(True)
            self.category_dropdown.button.setToolTip("")
            self.category_dropdown.set_options(
                sorted(
                    categories.items(),
                    key=lambda item: item[1].casefold(),
                ),
                preserve_selection=True,
            )

        if conditions:
            self.condition_dropdown.setEnabled(True)
            self.condition_dropdown.button.setToolTip("")
            self.condition_dropdown.set_options(
                sorted(
                    conditions.items(),
                    key=lambda item: item[1].casefold(),
                ),
                preserve_selection=True,
            )
        else:
            self.condition_dropdown.set_options([])
            self.condition_dropdown.setEnabled(False)
            self.condition_dropdown.button.setText(
                "Keine Zustände verfügbar"
            )

    def set_loading_state(self, is_loading: bool) -> None:
        self._is_loading = is_loading
        self._update_action_state()

    def set_selection(self, identifiers: list[str]) -> None:
        self._selection_count = len(identifiers)

        if self._selection_count == 0:
            self.selection_label.setText("Kein Eintrag ausgewählt")
        elif self._selection_count == 1:
            self.selection_label.setText(
                f"Ausgewählter Eintrag:\n{identifiers[0]}"
            )
        else:
            self.selection_label.setText(
                f"{self._selection_count} Einträge ausgewählt"
            )

        self._update_action_state()

    def _update_action_state(self) -> None:
        writable = not self._is_loading
        self.create_button.setEnabled(writable)
        self.edit_button.setEnabled(
            writable and self._selection_count == 1
        )
        self.delete_button.setEnabled(
            writable and self._selection_count > 0
        )

    def set_count_text(self, text: str) -> None:
        self.count_label.setText(text)