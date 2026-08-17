from __future__ import annotations
from copy import deepcopy
import re
from typing import Any
import unicodedata
from PySide6.QtCore import Qt, Signal, Slot
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QAbstractItemView, QCheckBox, QComboBox, QDialog, QFrame, QGridLayout, QHBoxLayout, QHeaderView, QLabel, QMessageBox, QPushButton, QSizePolicy, QTabWidget, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget
from inventory import DEFAULT_VISIBLE_COLUMNS, HEADER_LABELS, INVENTORY_GROUP_LABELS, PREFERRED_COLUMN_ORDER
META = Qt.ItemDataRole.UserRole
LOCATION_TYPES = {'warehouse': 'Lager', 'area': 'Bereich', 'room': 'Raum'}
SPEC_TYPES = {'text': 'Text', 'integer': 'Ganzzahl', 'number': 'Zahl', 'boolean': 'Ja / Nein'}
SPEC_SCOPES = {'model': 'Produktmodell', 'asset': 'Einzelartikel'}

def _technical_key(value: str, fallback: str) -> str:
    text = str(value or '').strip().casefold()
    text = text.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('ß', 'ss')
    text = unicodedata.normalize('NFKD', text)
    text = ''.join((ch for ch in text if not unicodedata.combining(ch)))
    return re.sub('[^a-z0-9]+', '_', text).strip('_') or fallback

def _unique_key(value: str, used: set[str], fallback: str) -> str:
    base = _technical_key(value, fallback)
    candidate, number = (base, 2)
    normalized = {str(item).casefold() for item in used}
    while candidate.casefold() in normalized:
        candidate, number = (f'{base}_{number}', number + 1)
    return candidate

class NoWheelComboBox(QComboBox):
    """Verhindert versehentliche Wertänderungen durch das Mausrad."""

    def wheelEvent(self, event) -> None:
        event.ignore()

class SettingsDialog(QDialog):
    """Stammdaten direkt im Einstellungsfenster bearbeiten."""
    submit_requested = Signal(object)

    def __init__(self, data: dict[str, Any], parent=None) -> None:
        super().__init__(parent)
        self.setObjectName('settingsDialog')
        self.setWindowTitle('Einstellungen')
        self.setMinimumSize(980, 660)
        self.resize(1160, 760)
        self._original = deepcopy(data)
        self._counter = 0
        self._saving = False
        self._deleted = {'sites': set(), 'departments': set(), 'storage_locations': set(), 'product_categories': set(), 'manufacturers': set()}
        self._schemas: dict[str, dict[str, Any]] = {}
        self._current_spec_category: str | None = None
        self._column_checks: dict[str, QCheckBox] = {}
        self._build_ui()
        self._load_data(data)
        self._load_columns(data.get('default_visible_columns'))
        self._apply_style()

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)
        self.tabs = QTabWidget()
        self.site_table = self._table(['Standort', 'Strasse', 'Nr.', 'PLZ', 'Ort', 'Land'])
        self.department_table = self._table(['Abteilung', 'Standort'])
        self.location_table = self._table(['Lagerort', 'Abteilung', 'Standort', 'Typ'])
        self.category_table = self._table(['Kategorie', 'Inventartyp'])
        self.manufacturer_table = self._table(['Hersteller'])
        self.tabs.addTab(self._structure_page(), 'Struktur')
        self.tabs.addTab(self._crud_page(self.category_table, self._add_category, self._delete_category), 'Kategorien')
        self.tabs.addTab(self._spec_page(), 'Spezifikationen')
        self.tabs.addTab(self._crud_page(self.manufacturer_table, self._add_manufacturer, self._delete_manufacturer), 'Hersteller')
        self.tabs.addTab(self._columns_page(), 'Standardspalten')
        root.addWidget(self.tabs, 1)
        buttons = QHBoxLayout()
        buttons.addStretch()
        self.cancel_button = QPushButton('Abbrechen')
        self.apply_button = QPushButton('Übernehmen')
        self.apply_button.setObjectName('primaryButton')
        self.cancel_button.clicked.connect(self.reject)
        self.apply_button.clicked.connect(self._submit)
        buttons.addWidget(self.cancel_button)
        buttons.addWidget(self.apply_button)
        root.addLayout(buttons)
        self.site_table.itemChanged.connect(self._site_changed)
        self.department_table.itemChanged.connect(self._department_changed)
        self.category_table.itemChanged.connect(self._category_changed)

    def _structure_page(self) -> QWidget:
        page = QWidget()
        page.setObjectName('structurePage')
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)
        sections = (('Standorte', self.site_table, self._add_site, self._delete_site), ('Abteilungen', self.department_table, self._add_department, self._delete_department), ('Lagerorte', self.location_table, self._add_location, self._delete_location))
        for index, (title, table, add_callback, delete_callback) in enumerate(sections):
            header = QHBoxLayout()
            title_label = QLabel(title)
            title_label.setObjectName('settingsSectionTitle')
            header.addWidget(title_label)
            header.addStretch()
            add_button = QPushButton('Hinzufügen')
            edit_button = QPushButton('Bearbeiten')
            delete_button = QPushButton('Löschen')
            add_button.clicked.connect(add_callback)
            edit_button.clicked.connect(lambda _checked=False, target=table: self._edit_current(target))
            delete_button.clicked.connect(delete_callback)
            header.addWidget(add_button)
            header.addWidget(edit_button)
            header.addWidget(delete_button)
            layout.addLayout(header)
            layout.addWidget(table, 1)
            if index < len(sections) - 1:
                separator = QFrame()
                separator.setFrameShape(QFrame.Shape.HLine)
                separator.setObjectName('settingsSeparator')
                layout.addWidget(separator)
        return page

    @staticmethod
    def _table(headers: list[str]) -> QTableWidget:
        table = QTableWidget(0, len(headers))
        table.setHorizontalHeaderLabels(headers)
        table.setAlternatingRowColors(True)
        table.setShowGrid(False)
        table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectItems)
        table.setEditTriggers(QAbstractItemView.EditTrigger.DoubleClicked | QAbstractItemView.EditTrigger.EditKeyPressed)
        table.verticalHeader().setVisible(False)
        table.verticalHeader().setDefaultSectionSize(34)
        table.verticalHeader().setMinimumSectionSize(34)
        table.verticalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        table.horizontalHeader().setDefaultAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        table.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        table.setHorizontalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        table.setWordWrap(False)
        return table

    def _crud_page(self, table: QTableWidget, add, delete) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)
        actions = QHBoxLayout()
        for text, callback in (('Hinzufügen', add), ('Bearbeiten', lambda _=False, target=table: self._edit_current(target)), ('Löschen', delete)):
            button = QPushButton(text)
            button.clicked.connect(callback)
            actions.addWidget(button)
        actions.addStretch()
        layout.addLayout(actions)
        layout.addWidget(table, 1)
        return page

    def _spec_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)
        top = QHBoxLayout()
        top.addWidget(QLabel('Kategorie:'))
        self.spec_category = NoWheelComboBox()
        self.spec_category.currentIndexChanged.connect(self._spec_category_changed)
        top.addWidget(self.spec_category, 1)
        for text, callback in (('Hinzufügen', self._add_spec), ('Bearbeiten', lambda: self._edit_current(self.spec_table)), ('Löschen', self._delete_spec)):
            button = QPushButton(text)
            button.clicked.connect(callback)
            top.addWidget(button)
        self.spec_table = self._table(['Bezeichnung', 'Typ', 'Einheit', 'Gültig für'])
        layout.addLayout(top)
        layout.addWidget(self.spec_table, 1)
        return page

    def _columns_page(self) -> QWidget:
        page = QWidget()
        page.setObjectName('columnsPage')
        layout = QVBoxLayout(page)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)
        info = QLabel('Wähle die Spalten, die bei „Standardansicht“ sichtbar sein sollen.')
        info.setObjectName('columnsInfo')
        layout.addWidget(info)
        actions = QHBoxLayout()
        actions.setSpacing(6)
        for text, columns in (('Alle auswählen', set(PREFERRED_COLUMN_ORDER)), ('Werkseinstellung', set(DEFAULT_VISIBLE_COLUMNS))):
            button = QPushButton(text)
            button.clicked.connect(lambda _checked=False, value=columns: self._set_columns(value))
            actions.addWidget(button)
        actions.addStretch()
        layout.addLayout(actions)
        columns_box = QFrame()
        columns_box.setObjectName('columnsBox')
        grid = QGridLayout(columns_box)
        grid.setContentsMargins(8, 8, 8, 8)
        grid.setHorizontalSpacing(6)
        grid.setVerticalSpacing(6)
        column_count = 3
        for index, name in enumerate(PREFERRED_COLUMN_ORDER):
            check = QCheckBox(HEADER_LABELS.get(name, name.replace('_', ' ').title()))
            check.setObjectName('columnCheck')
            self._column_checks[name] = check
            grid.addWidget(check, index // column_count, index % column_count)
        for column in range(column_count):
            grid.setColumnStretch(column, 1)
        layout.addWidget(columns_box)
        layout.addStretch(1)
        return page

    def _load_data(self, data: dict[str, Any]) -> None:
        for row in data.get('sites', []):
            if isinstance(row, dict):
                self._insert_site(deepcopy(row))
        site_refs = self._id_refs(self.site_table)
        for row in data.get('departments', []):
            if isinstance(row, dict):
                current = deepcopy(row)
                current['site_ref'] = site_refs.get(current.get('site_id'))
                self._insert_department(current)
        department_refs = self._id_refs(self.department_table)
        for row in data.get('storage_locations', []):
            if isinstance(row, dict):
                current = deepcopy(row)
                current['department_ref'] = department_refs.get(current.get('department_id'))
                self._insert_location(current)
        for row in data.get('product_categories', []):
            if not isinstance(row, dict):
                continue
            current = deepcopy(row)
            ref = self._client_key(current, 'category')
            schema = deepcopy(current.get('specification_schema'))
            if not isinstance(schema, dict):
                schema = {'fields': []}
            schema.setdefault('fields', [])
            self._schemas[ref] = schema
            self._insert_category(current)
        for row in data.get('manufacturers', []):
            if isinstance(row, dict):
                self._insert_manufacturer(deepcopy(row))
        self._refresh_relations()
        self._refresh_spec_categories()

    def _load_columns(self, configured: object) -> None:
        selected = set(configured) if isinstance(configured, (list, tuple, set)) else set(DEFAULT_VISIBLE_COLUMNS)
        self._set_columns(selected)

    def _insert_site(self, data: dict[str, Any]) -> None:
        row = self.site_table.rowCount()
        self.site_table.insertRow(row)
        values = (data.get('name'), data.get('street'), data.get('street_number'), data.get('postal_code'), data.get('city'), data.get('country'))
        for column, value in enumerate(values):
            item = self._item(value)
            if column == 0:
                item.setData(META, {'id': data.get('id'), 'client_key': self._client_key(data, 'site'), 'organization_id': data.get('organization_id')})
            self.site_table.setItem(row, column, item)

    def _insert_department(self, data: dict[str, Any]) -> None:
        row = self.department_table.rowCount()
        self.department_table.insertRow(row)
        item = self._item(data.get('name'))
        item.setData(META, {'id': data.get('id'), 'client_key': self._client_key(data, 'department'), 'organization_id': data.get('organization_id')})
        self.department_table.setItem(row, 0, item)
        combo = self._combo()
        self.department_table.setCellWidget(row, 1, combo)
        self._fill_site_combo(combo, data.get('site_ref'))
        combo.currentIndexChanged.connect(self._department_site_changed)

    def _insert_location(self, data: dict[str, Any]) -> None:
        row = self.location_table.rowCount()
        self.location_table.insertRow(row)
        item = self._item(data.get('name'))
        item.setData(META, {'id': data.get('id'), 'client_key': self._client_key(data, 'location'), 'parent_location_id': data.get('parent_location_id'), 'code': data.get('code')})
        self.location_table.setItem(row, 0, item)
        department = self._combo()
        self.location_table.setCellWidget(row, 1, department)
        self._fill_department_combo(department, data.get('department_ref'))
        department.currentIndexChanged.connect(self._location_department_changed)
        site = self._item('')
        site.setFlags(site.flags() & ~Qt.ItemFlag.ItemIsEditable)
        self.location_table.setItem(row, 2, site)
        location_type = self._combo()
        for value, label in LOCATION_TYPES.items():
            location_type.addItem(label, value)
        self._set_combo(location_type, data.get('location_type') or 'warehouse')
        self.location_table.setCellWidget(row, 3, location_type)
        self._update_location_site(row)

    def _insert_category(self, data: dict[str, Any]) -> None:
        row = self.category_table.rowCount()
        self.category_table.insertRow(row)
        item = self._item(data.get('name'))
        item.setData(META, {'id': data.get('id'), 'client_key': self._client_key(data, 'category'), 'code': data.get('code')})
        self.category_table.setItem(row, 0, item)
        combo = self._combo()
        for value, label in INVENTORY_GROUP_LABELS.items():
            combo.addItem(label, value)
        self._set_combo(combo, data.get('inventory_group') or 'other')
        self.category_table.setCellWidget(row, 1, combo)

    def _insert_manufacturer(self, data: dict[str, Any]) -> None:
        row = self.manufacturer_table.rowCount()
        self.manufacturer_table.insertRow(row)
        item = self._item(data.get('name'))
        item.setData(META, {'id': data.get('id'), 'client_key': self._client_key(data, 'manufacturer')})
        if item.text().strip().casefold() == 'keiner':
            item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
        self.manufacturer_table.setItem(row, 0, item)

    def _insert_spec(self, data: dict[str, Any]) -> None:
        row = self.spec_table.rowCount()
        self.spec_table.insertRow(row)
        label = self._item(data.get('label'))
        label.setData(META, {'key': data.get('key')})
        self.spec_table.setItem(row, 0, label)
        spec_type = self._combo()
        for value, text in SPEC_TYPES.items():
            spec_type.addItem(text, value)
        self._set_combo(spec_type, data.get('type') or 'text')
        self.spec_table.setCellWidget(row, 1, spec_type)
        self.spec_table.setItem(row, 2, self._item(data.get('unit')))
        scope = self._combo()
        for value, text in SPEC_SCOPES.items():
            scope.addItem(text, value)
        self._set_combo(scope, data.get('scope') or 'model')
        self.spec_table.setCellWidget(row, 3, scope)

    @Slot()
    def _add_site(self) -> None:
        self._insert_site({'id': None, 'client_key': self._new_key('site'), 'name': '', 'organization_id': None})
        self._edit_new(self.site_table)

    @Slot()
    def _add_department(self) -> None:
        if not self.site_table.rowCount():
            return self._warn('Abteilung', 'Bitte zuerst einen Standort anlegen.')
        self._insert_department({'id': None, 'client_key': self._new_key('department'), 'name': '', 'site_ref': self._first_ref(self.site_table), 'organization_id': None})
        self._edit_new(self.department_table)

    @Slot()
    def _add_location(self) -> None:
        if not self.department_table.rowCount():
            return self._warn('Lagerort', 'Bitte zuerst eine Abteilung anlegen.')
        self._insert_location({'id': None, 'client_key': self._new_key('location'), 'name': '', 'department_ref': self._first_ref(self.department_table), 'location_type': 'warehouse', 'parent_location_id': None, 'code': None})
        self._edit_new(self.location_table)

    @Slot()
    def _add_category(self) -> None:
        ref = self._new_key('category')
        self._schemas[ref] = {'fields': []}
        self._insert_category({'id': None, 'client_key': ref, 'name': '', 'code': None, 'inventory_group': 'other'})
        self._refresh_spec_categories()
        self._edit_new(self.category_table)

    @Slot()
    def _add_manufacturer(self) -> None:
        self._insert_manufacturer({'id': None, 'client_key': self._new_key('manufacturer'), 'name': ''})
        self._edit_new(self.manufacturer_table)

    @Slot()
    def _add_spec(self) -> None:
        if self.spec_category.currentData() is None:
            return self._warn('Spezifikation', 'Bitte zuerst eine Kategorie auswählen.')
        self._insert_spec({'key': None, 'label': '', 'type': 'text', 'scope': 'model'})
        self._edit_new(self.spec_table)

    def _edit_current(self, table: QTableWidget) -> None:
        row, column = (table.currentRow(), table.currentColumn())
        if row < 0:
            return self._warn('Bearbeiten', 'Bitte zuerst einen Eintrag auswählen.')
        item = table.item(row, max(column, 0)) or table.item(row, 0)
        if item is not None and item.flags() & Qt.ItemFlag.ItemIsEditable:
            table.setCurrentItem(item)
            table.editItem(item)

    @staticmethod
    def _edit_new(table: QTableWidget) -> None:
        row = table.rowCount() - 1
        table.setCurrentCell(row, 0)
        item = table.item(row, 0)
        if item is not None:
            table.editItem(item)

    def _delete_site(self) -> None:
        row = self.site_table.currentRow()
        ref = self._ref_at(self.site_table, row)
        if ref and self._ref_used(self.department_table, 1, ref):
            return self._warn('Standort löschen', 'Der Standort wird noch von einer Abteilung verwendet.')
        self._delete_row(self.site_table, 'sites', 'Standort', row)
        self._refresh_relations()

    def _delete_department(self) -> None:
        row = self.department_table.currentRow()
        ref = self._ref_at(self.department_table, row)
        if ref and self._ref_used(self.location_table, 1, ref):
            return self._warn('Abteilung löschen', 'Die Abteilung wird noch von einem Lagerort verwendet.')
        self._delete_row(self.department_table, 'departments', 'Abteilung', row)
        self._refresh_relations()

    def _delete_location(self) -> None:
        self._delete_row(self.location_table, 'storage_locations', 'Lagerort', self.location_table.currentRow())

    def _delete_category(self) -> None:
        row = self.category_table.currentRow()
        ref = self._ref_at(self.category_table, row)
        if self._delete_row(self.category_table, 'product_categories', 'Kategorie', row):
            if ref:
                self._schemas.pop(ref, None)
            self._refresh_spec_categories()

    def _delete_manufacturer(self) -> None:
        row = self.manufacturer_table.currentRow()
        item = self.manufacturer_table.item(row, 0)
        if item is not None and item.text().strip().casefold() == 'keiner':
            return self._warn('Hersteller', 'Der technische Eintrag „Keiner“ kann nicht gelöscht werden.')
        self._delete_row(self.manufacturer_table, 'manufacturers', 'Hersteller', row)

    def _delete_spec(self) -> None:
        row = self.spec_table.currentRow()
        if row < 0:
            return self._warn('Spezifikation', 'Bitte zuerst eine Spezifikation auswählen.')
        self.spec_table.removeRow(row)

    def _delete_row(self, table: QTableWidget, delete_key: str, label: str, row: int) -> bool:
        if row < 0:
            self._warn(label, f'Bitte zuerst einen Eintrag unter „{label}“ auswählen.')
            return False
        item = table.item(row, 0)
        name = item.text().strip() if item else label
        answer = QMessageBox.question(self, f'{label} löschen', f'„{name or label}“ wirklich löschen?', QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No, QMessageBox.StandardButton.No)
        if answer != QMessageBox.StandardButton.Yes:
            return False
        meta = item.data(META) if item is not None else None
        if isinstance(meta, dict) and meta.get('id') is not None:
            self._deleted[delete_key].add(meta['id'])
        table.removeRow(row)
        return True

    @Slot(QTableWidgetItem)
    def _site_changed(self, item: QTableWidgetItem) -> None:
        if item.column() == 0:
            self._refresh_relations()

    @Slot(QTableWidgetItem)
    def _department_changed(self, item: QTableWidgetItem) -> None:
        if item.column() == 0:
            self._refresh_department_labels()

    @Slot(QTableWidgetItem)
    def _category_changed(self, item: QTableWidgetItem) -> None:
        if item.column() == 0:
            self._refresh_spec_categories()

    @Slot(int)
    def _department_site_changed(self, _index: int) -> None:
        self._refresh_department_labels()

    @Slot(int)
    def _location_department_changed(self, _index: int) -> None:
        combo = self.sender()
        if not isinstance(combo, QComboBox):
            return
        for row in range(self.location_table.rowCount()):
            if self.location_table.cellWidget(row, 1) is combo:
                self._update_location_site(row)
                break

    def _refresh_relations(self) -> None:
        for row in range(self.department_table.rowCount()):
            combo = self.department_table.cellWidget(row, 1)
            if isinstance(combo, QComboBox):
                selected = combo.currentData()
                self._fill_site_combo(combo, selected)
        self._refresh_department_labels()

    def _refresh_department_labels(self) -> None:
        for row in range(self.location_table.rowCount()):
            combo = self.location_table.cellWidget(row, 1)
            if isinstance(combo, QComboBox):
                selected = combo.currentData()
                self._fill_department_combo(combo, selected)
        self._refresh_location_sites()

    def _refresh_location_sites(self) -> None:
        for row in range(self.location_table.rowCount()):
            self._update_location_site(row)

    def _update_location_site(self, row: int) -> None:
        department = self.location_table.cellWidget(row, 1)
        site_item = self.location_table.item(row, 2)
        if not isinstance(department, QComboBox) or site_item is None:
            return
        site_item.setText(self._site_name(self._department_site_ref(department.currentData())))

    def _fill_site_combo(self, combo: QComboBox, selected: Any) -> None:
        combo.blockSignals(True)
        combo.clear()
        combo.addItem('Standort auswählen', None)
        for ref, name in self._site_choices():
            combo.addItem(name, ref)
        self._set_combo(combo, selected)
        combo.blockSignals(False)

    def _fill_department_combo(self, combo: QComboBox, selected: Any) -> None:
        combo.blockSignals(True)
        combo.clear()
        combo.addItem('Abteilung auswählen', None)
        for ref, label in self._department_choices():
            combo.addItem(label, ref)
        self._set_combo(combo, selected)
        combo.blockSignals(False)

    def _site_choices(self) -> list[tuple[str, str]]:
        result = []
        for row in range(self.site_table.rowCount()):
            ref = self._ref_at(self.site_table, row)
            name = self._cell(self.site_table, row, 0) or '(Standort ohne Name)'
            if ref:
                result.append((ref, name))
        return sorted(result, key=lambda item: item[1].casefold())

    def _department_choices(self) -> list[tuple[str, str]]:
        result = []
        for row in range(self.department_table.rowCount()):
            ref = self._ref_at(self.department_table, row)
            combo = self.department_table.cellWidget(row, 1)
            if not ref or not isinstance(combo, QComboBox):
                continue
            name = self._cell(self.department_table, row, 0) or '(Abteilung ohne Name)'
            result.append((ref, f'{self._site_name(combo.currentData())} – {name}'))
        return sorted(result, key=lambda item: item[1].casefold())

    def _department_site_ref(self, department_ref: Any) -> Any:
        for row in range(self.department_table.rowCount()):
            if self._ref_at(self.department_table, row) != department_ref:
                continue
            combo = self.department_table.cellWidget(row, 1)
            return combo.currentData() if isinstance(combo, QComboBox) else None
        return None

    def _site_name(self, site_ref: Any) -> str:
        for ref, name in self._site_choices():
            if ref == site_ref:
                return name
        return 'Nicht zugeordnet'

    @Slot(int)
    def _spec_category_changed(self, _index: int) -> None:
        self._save_current_specs()
        self._load_current_specs()

    def _refresh_spec_categories(self) -> None:
        self._save_current_specs()
        selected = self.spec_category.currentData()
        self.spec_category.blockSignals(True)
        self.spec_category.clear()
        for row in range(self.category_table.rowCount()):
            ref = self._ref_at(self.category_table, row)
            if ref:
                self.spec_category.addItem(self._cell(self.category_table, row, 0) or '(Kategorie ohne Name)', ref)
        index = self.spec_category.findData(selected)
        self.spec_category.setCurrentIndex(index if index >= 0 else 0 if self.spec_category.count() else -1)
        self.spec_category.blockSignals(False)
        self._load_current_specs()

    def _save_current_specs(self) -> None:
        if not self._current_spec_category:
            return
        schema = deepcopy(self._schemas.get(self._current_spec_category, {'fields': []}))
        schema['fields'] = self._collect_specs()
        self._schemas[self._current_spec_category] = schema

    def _load_current_specs(self) -> None:
        self.spec_table.setRowCount(0)
        key = self.spec_category.currentData()
        self._current_spec_category = str(key) if key is not None else None
        schema = self._schemas.get(self._current_spec_category or '', {})
        fields = schema.get('fields') if isinstance(schema, dict) else []
        if isinstance(fields, list):
            for field in fields:
                if isinstance(field, dict):
                    self._insert_spec(deepcopy(field))

    def _collect_specs(self) -> list[dict[str, Any]]:
        fields, used = ([], set())
        for row in range(self.spec_table.rowCount()):
            label_item = self.spec_table.item(row, 0)
            unit_item = self.spec_table.item(row, 2)
            type_combo = self.spec_table.cellWidget(row, 1)
            scope_combo = self.spec_table.cellWidget(row, 3)
            label = label_item.text().strip() if label_item else ''
            meta = label_item.data(META) if label_item else {}
            key = str(meta.get('key') or '').strip() if isinstance(meta, dict) else ''
            if not key and label:
                key = _unique_key(label, used, 'spezifikation')
            if key:
                used.add(key)
            field = {'key': key, 'label': label, 'type': type_combo.currentData() if isinstance(type_combo, QComboBox) else 'text', 'scope': scope_combo.currentData() if isinstance(scope_combo, QComboBox) else 'model'}
            unit = unit_item.text().strip() if unit_item else ''
            if unit:
                field['unit'] = unit
            fields.append(field)
        return fields

    def _validate(self) -> list[str]:
        self._save_current_specs()
        self._clear_errors()
        errors: list[str] = []
        for table, label in ((self.site_table, 'Standort'), (self.category_table, 'Kategorie'), (self.manufacturer_table, 'Hersteller')):
            self._validate_unique_text(table, label, errors)
        seen: set[tuple[str, str]] = set()
        for row in range(self.department_table.rowCount()):
            item = self.department_table.item(row, 0)
            combo = self.department_table.cellWidget(row, 1)
            name = item.text().strip() if item else ''
            site_ref = str(combo.currentData() or '') if isinstance(combo, QComboBox) else ''
            if not name:
                self._invalid(item, errors, 'Abteilung: Name fehlt.')
            if not site_ref:
                errors.append(f"Abteilung „{name or 'ohne Name'}“: Standort fehlt.")
            key = (site_ref, name.casefold())
            if name and key in seen:
                self._invalid(item, errors, f'Abteilung „{name}“ ist am selben Standort doppelt vorhanden.')
            seen.add(key)
        seen.clear()
        for row in range(self.location_table.rowCount()):
            item = self.location_table.item(row, 0)
            department = self.location_table.cellWidget(row, 1)
            location_type = self.location_table.cellWidget(row, 3)
            name = item.text().strip() if item else ''
            department_ref = str(department.currentData() or '') if isinstance(department, QComboBox) else ''
            if not name:
                self._invalid(item, errors, 'Lagerort: Name fehlt.')
            if not department_ref:
                errors.append(f"Lagerort „{name or 'ohne Name'}“: Abteilung fehlt.")
            if not isinstance(location_type, QComboBox) or location_type.currentData() not in LOCATION_TYPES:
                errors.append(f"Lagerort „{name or 'ohne Name'}“: Typ ist ungültig.")
            key = (department_ref, name.casefold())
            if name and key in seen:
                self._invalid(item, errors, f'Lagerort „{name}“ ist in derselben Abteilung doppelt vorhanden.')
            seen.add(key)
        for category_ref, schema in self._schemas.items():
            if not self._category_exists(category_ref):
                continue
            fields = schema.get('fields') if isinstance(schema, dict) else []
            if not isinstance(fields, list):
                errors.append(f'Kategorie „{self._category_name(category_ref)}“: Spezifikationen sind ungültig.')
                continue
            labels, keys = (set(), set())
            for field in fields:
                if not isinstance(field, dict):
                    continue
                label = str(field.get('label') or '').strip()
                key = str(field.get('key') or '').strip()
                if not label:
                    errors.append(f'Kategorie „{self._category_name(category_ref)}“: Spezifikationsbezeichnung fehlt.')
                elif label.casefold() in labels:
                    errors.append(f'Kategorie „{self._category_name(category_ref)}“: Spezifikation „{label}“ ist doppelt.')
                labels.add(label.casefold())
                if not key or key.casefold() in keys:
                    errors.append(f'Kategorie „{self._category_name(category_ref)}“: technischer Spezifikationsschlüssel ist ungültig oder doppelt.')
                keys.add(key.casefold())
        if not any((check.isChecked() for check in self._column_checks.values())):
            errors.append('Standardspalten: Mindestens eine Spalte muss ausgewählt sein.')
        return errors

    def _validate_unique_text(self, table: QTableWidget, label: str, errors: list[str]) -> None:
        seen = set()
        for row in range(table.rowCount()):
            item = table.item(row, 0)
            value = item.text().strip() if item else ''
            if not value:
                self._invalid(item, errors, f'{label}: Name fehlt.')
                continue
            key = value.casefold()
            if key in seen:
                self._invalid(item, errors, f'{label} „{value}“ ist doppelt vorhanden.')
            seen.add(key)

    @staticmethod
    def _invalid(item: QTableWidgetItem | None, errors: list[str], message: str) -> None:
        errors.append(message)
        if item is not None:
            item.setBackground(QColor('#ffd7d7'))

    def _clear_errors(self) -> None:
        for table in (self.site_table, self.department_table, self.location_table, self.category_table, self.manufacturer_table, self.spec_table):
            for row in range(table.rowCount()):
                for column in range(table.columnCount()):
                    item = table.item(row, column)
                    if item is not None:
                        item.setBackground(QColor('transparent'))

    @Slot()
    def _submit(self) -> None:
        if self._saving:
            return
        errors = self._validate()
        if errors:
            QMessageBox.warning(self, 'Einstellungen prüfen', 'Bitte korrigiere folgende Punkte:\n\n' + '\n'.join((f'• {error}' for error in errors)))
            return
        payload = {'sites': self._changed_rows('sites', self._collect_sites()), 'departments': self._changed_rows('departments', self._collect_departments()), 'storage_locations': self._changed_rows('storage_locations', self._collect_locations()), 'product_categories': self._category_payload(), 'manufacturers': self._changed_rows('manufacturers', self._collect_manufacturers()), 'deleted': {key: list(ids) for key, ids in self._deleted.items()}, 'default_visible_columns': [name for name, check in self._column_checks.items() if check.isChecked()]}
        self.set_saving(True)
        self.submit_requested.emit(payload)

    def _collect_sites(self) -> list[dict[str, Any]]:
        rows = []
        for row in range(self.site_table.rowCount()):
            rows.append({**self._meta(self.site_table, row), 'name': self._cell(self.site_table, row, 0), 'street': self._none(self._cell(self.site_table, row, 1)), 'street_number': self._none(self._cell(self.site_table, row, 2)), 'postal_code': self._none(self._cell(self.site_table, row, 3)), 'city': self._none(self._cell(self.site_table, row, 4)), 'country': self._none(self._cell(self.site_table, row, 5))})
        return rows

    def _collect_departments(self) -> list[dict[str, Any]]:
        rows = []
        for row in range(self.department_table.rowCount()):
            meta = self._meta(self.department_table, row)
            combo = self.department_table.cellWidget(row, 1)
            site_ref = combo.currentData() if isinstance(combo, QComboBox) else None
            original = self._original_by_id('departments', meta.get('id'))
            organization_id = meta.get('organization_id')
            if original and site_ref != f"id:{original.get('site_id')}":
                organization_id = None
            rows.append({**meta, 'name': self._cell(self.department_table, row, 0), 'site_ref': site_ref, 'organization_id': organization_id})
        return rows

    def _collect_locations(self) -> list[dict[str, Any]]:
        rows = []
        for row in range(self.location_table.rowCount()):
            meta = self._meta(self.location_table, row)
            department = self.location_table.cellWidget(row, 1)
            location_type = self.location_table.cellWidget(row, 3)
            department_ref = department.currentData() if isinstance(department, QComboBox) else None
            rows.append({**meta, 'name': self._cell(self.location_table, row, 0), 'department_ref': department_ref, 'site_ref': self._department_site_ref(department_ref), 'location_type': location_type.currentData() if isinstance(location_type, QComboBox) else 'warehouse', 'is_active': True})
        return rows

    def _collect_categories(self) -> list[dict[str, Any]]:
        self._save_current_specs()
        rows = []
        for row in range(self.category_table.rowCount()):
            meta = self._meta(self.category_table, row)
            group = self.category_table.cellWidget(row, 1)
            ref = str(meta.get('client_key') or '')
            rows.append({**meta, 'name': self._cell(self.category_table, row, 0), 'inventory_group': group.currentData() if isinstance(group, QComboBox) else 'other', 'specification_schema': deepcopy(self._schemas.get(ref, {'fields': []}))})
        return rows

    def _collect_manufacturers(self) -> list[dict[str, Any]]:
        return [{**self._meta(self.manufacturer_table, row), 'name': self._cell(self.manufacturer_table, row, 0)} for row in range(self.manufacturer_table.rowCount())]

    def _changed_rows(self, source: str, current: list[dict[str, Any]]) -> list[dict[str, Any]]:
        originals = {row.get('id'): self._normalize_original(source, row) for row in self._original.get(source, []) if isinstance(row, dict) and row.get('id') is not None}
        return [row for row in current if row.get('id') is None or row != originals.get(row.get('id'))]

    @staticmethod
    def _normalize_original(source: str, row: dict[str, Any]) -> dict[str, Any]:
        result = deepcopy(row)
        row_id = result.get('id')
        result['client_key'] = f'id:{row_id}'
        if source == 'departments':
            result['site_ref'] = f"id:{result.pop('site_id')}"
        elif source == 'storage_locations':
            result['site_ref'] = f"id:{result.pop('site_id')}"
            department_id = result.pop('department_id')
            result['department_ref'] = f'id:{department_id}' if department_id is not None else None
            result['is_active'] = True
        return result

    def _category_payload(self) -> list[dict[str, Any]]:
        current = self._collect_categories()
        originals = {row.get('id'): deepcopy(row) for row in self._original.get('product_categories', []) if isinstance(row, dict) and row.get('id') is not None}
        used_codes = {str(row.get('code') or '').strip() for row in originals.values() if str(row.get('code') or '').strip()}
        result = []
        for row in current:
            row_id = row.get('id')
            if row_id is None:
                row['code'] = _unique_key(row.get('name') or '', used_codes, 'kategorie')
                used_codes.add(row['code'])
                result.append(row)
                continue
            original = deepcopy(originals.get(row_id, {}))
            original['client_key'] = f'id:{row_id}'
            if row != original:
                row['code'] = original.get('code')
                result.append(row)
        return result

    def _refresh_location_sites(self) -> None:
        for row in range(self.location_table.rowCount()):
            self._update_location_site(row)

    def _category_exists(self, ref: str) -> bool:
        return any((self._ref_at(self.category_table, row) == ref for row in range(self.category_table.rowCount())))

    def _category_name(self, ref: str) -> str:
        for row in range(self.category_table.rowCount()):
            if self._ref_at(self.category_table, row) == ref:
                return self._cell(self.category_table, row, 0)
        return 'Kategorie'

    @staticmethod
    def _item(value: Any) -> QTableWidgetItem:
        return QTableWidgetItem(str(value or ''))

    @staticmethod
    def _combo() -> QComboBox:
        combo = NoWheelComboBox()
        combo.setObjectName('tableCombo')
        combo.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        return combo

    @staticmethod
    def _set_combo(combo: QComboBox, value: Any) -> None:
        index = combo.findData(value)
        combo.setCurrentIndex(index if index >= 0 else 0)

    def _meta(self, table: QTableWidget, row: int) -> dict[str, Any]:
        item = table.item(row, 0)
        data = item.data(META) if item is not None else None
        return deepcopy(data) if isinstance(data, dict) else {}

    @staticmethod
    def _cell(table: QTableWidget, row: int, column: int) -> str:
        item = table.item(row, column)
        return item.text().strip() if item else ''

    def _ref_at(self, table: QTableWidget, row: int) -> str | None:
        if row < 0:
            return None
        ref = self._meta(table, row).get('client_key')
        return str(ref) if ref else None

    def _first_ref(self, table: QTableWidget) -> str | None:
        return self._ref_at(table, 0) if table.rowCount() else None

    def _id_refs(self, table: QTableWidget) -> dict[Any, str]:
        result = {}
        for row in range(table.rowCount()):
            meta = self._meta(table, row)
            if meta.get('id') is not None:
                result[meta['id']] = str(meta.get('client_key'))
        return result

    def _client_key(self, data: dict[str, Any], prefix: str) -> str:
        if str(data.get('client_key') or '').strip():
            return str(data['client_key'])
        if data.get('id') is not None:
            return f"id:{data['id']}"
        return self._new_key(prefix)

    def _new_key(self, prefix: str) -> str:
        self._counter += 1
        return f'new:{prefix}:{self._counter}'

    def _original_by_id(self, source: str, row_id: Any) -> dict[str, Any] | None:
        return next((row for row in self._original.get(source, []) if isinstance(row, dict) and row.get('id') == row_id), None)

    @staticmethod
    def _none(value: str) -> str | None:
        value = str(value or '').strip()
        return value or None

    @staticmethod
    def _ref_used(table: QTableWidget, column: int, ref: str) -> bool:
        return any((isinstance(table.cellWidget(row, column), QComboBox) and table.cellWidget(row, column).currentData() == ref for row in range(table.rowCount())))

    def _warn(self, title: str, text: str) -> None:
        QMessageBox.information(self, title, text)

    def _set_columns(self, selected: set[str]) -> None:
        for name, check in self._column_checks.items():
            check.setChecked(name in selected)

    def set_saving(self, saving: bool) -> None:
        self._saving = saving
        self.tabs.setEnabled(not saving)
        self.cancel_button.setEnabled(not saving)
        self.apply_button.setEnabled(not saving)
        self.apply_button.setText('Wird gespeichert ...' if saving else 'Übernehmen')

    def _apply_style(self) -> None:
        self.setStyleSheet('\n            QDialog#settingsDialog {\n                background: #f4f6f8;\n                color: #111827;\n            }\n\n            QDialog#settingsDialog QTabWidget::pane {\n                background: #ffffff;\n                border: 1px solid #d8dde3;\n                border-radius: 5px;\n            }\n\n            QDialog#settingsDialog QTabBar::tab {\n                background: #e9eef4;\n                color: #111827;\n                padding: 8px 12px;\n                border: 1px solid #d8dde3;\n                border-bottom: none;\n            }\n\n            QDialog#settingsDialog QTabBar::tab:selected {\n                background: #ffffff;\n                font-weight: 600;\n            }\n\n            QDialog#settingsDialog QTableWidget {\n                background: #ffffff;\n                alternate-background-color: #f7f9fb;\n                color: #111827;\n                border: 1px solid #d8dde3;\n                gridline-color: transparent;\n            }\n\n            QDialog#settingsDialog QHeaderView::section {\n                background: #eef2f6;\n                color: #111827;\n                border: none;\n                border-bottom: 1px solid #d8dde3;\n                padding: 7px 9px;\n                font-weight: 600;\n            }\n\n            QDialog#settingsDialog QTableWidget::item {\n                padding: 5px 8px;\n                border: none;\n            }\n\n            QDialog#settingsDialog QTableWidget::item:selected {\n                background: #dbeafe;\n                color: #111827;\n            }\n\n            /* Normale Dropdowns ausserhalb einer Tabelle */\n            QDialog#settingsDialog QComboBox {\n                background: #ffffff;\n                color: #111827;\n                border: 1px solid #c9d1d9;\n                border-radius: 3px;\n                padding: 0 6px;\n                min-height: 28px;\n            }\n\n            /* In Tabellen exakt auf die Zelle ausrichten */\n            QDialog#settingsDialog QComboBox#tableCombo {\n                background: transparent;\n                border: none;\n                border-radius: 0;\n                margin: 0;\n                padding: 0 8px;\n                min-height: 0;\n            }\n\n            QDialog#settingsDialog QComboBox#tableCombo:hover {\n                background: #f1f5f9;\n            }\n\n            QDialog#settingsDialog QComboBox#tableCombo:focus {\n                background: #ffffff;\n                border: 1px solid #8ab4e8;\n            }\n\n            QDialog#settingsDialog QComboBox QAbstractItemView {\n                background: #ffffff;\n                color: #111827;\n                border: 1px solid #c9d1d9;\n                selection-background-color: #dbeafe;\n                selection-color: #111827;\n                outline: 0;\n            }\n\n            QDialog#settingsDialog QLabel#settingsSectionTitle {\n                color: #111827;\n                background: transparent;\n                font-weight: 600;\n                font-size: 13px;\n                padding-left: 2px;\n            }\n\n            QDialog#settingsDialog QFrame#settingsSeparator {\n                background: #d8dde3;\n                color: #d8dde3;\n                max-height: 1px;\n            }\n\n            /* Standardspalten unabhängig vom Windows-Dark-Mode hell */\n            QDialog#settingsDialog QWidget#columnsPage {\n                background: #ffffff;\n                color: #111827;\n            }\n\n            QDialog#settingsDialog QLabel#columnsInfo {\n                background: transparent;\n                color: #4b5563;\n            }\n\n            QDialog#settingsDialog QFrame#columnsBox {\n                background: #ffffff;\n                border: 1px solid #d8dde3;\n                border-radius: 5px;\n            }\n\n            QDialog#settingsDialog QCheckBox#columnCheck {\n                background: #fafbfc;\n                color: #111827;\n                border: 1px solid #e1e6eb;\n                border-radius: 4px;\n                padding: 5px 8px;\n                spacing: 6px;\n                min-height: 22px;\n            }\n\n            QDialog#settingsDialog QCheckBox#columnCheck:hover {\n                background: #f1f5f9;\n                border-color: #c7d2df;\n            }\n\n            QDialog#settingsDialog QCheckBox#columnCheck:checked {\n                background: #eef6ff;\n                border-color: #9cc4f2;\n            }\n\n            QDialog#settingsDialog QPushButton {\n                min-height: 30px;\n                padding: 2px 12px;\n            }\n            ')