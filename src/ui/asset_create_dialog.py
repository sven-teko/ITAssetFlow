from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from PySide6.QtCore import QDate, QEvent, QLocale, Qt, Signal
from PySide6.QtGui import QColor, QDoubleValidator, QIntValidator, QPalette
from PySide6.QtWidgets import (
    QCalendarWidget,
    QComboBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QScrollArea,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from inventory import (
    CATEGORY_LABELS,
    CONDITION_LABELS,
    STATUS_LABELS,
    get_specification_fields,
    normalize_specification_key,
    normalize_specifications,
)



def _forward_wheel_to_scroll_area(widget: QWidget, event) -> None:
    """Leitet Mausradbewegungen an den Dialog-Scrollbereich weiter.

    Dadurch ändert das Mausrad weder Dropdown-Auswahlen noch Datumswerte,
    während der Dialog weiterhin normal gescrollt werden kann.
    """

    parent = widget.parentWidget()
    while parent is not None and not isinstance(parent, QScrollArea):
        parent = parent.parentWidget()

    if not isinstance(parent, QScrollArea):
        event.ignore()
        return

    bar = parent.verticalScrollBar()
    pixel_delta = event.pixelDelta().y()
    step = (
        pixel_delta
        if pixel_delta
        else int((event.angleDelta().y() / 120.0) * max(1, bar.singleStep()) * 3)
    )
    bar.setValue(bar.value() - step)
    event.accept()


class NoWheelComboBox(QComboBox):
    def wheelEvent(self, event) -> None:  # noqa: N802 - Qt API
        _forward_wheel_to_scroll_area(self, event)


class NoWheelDateEdit(QDateEdit):
    def wheelEvent(self, event) -> None:  # noqa: N802 - Qt API
        _forward_wheel_to_scroll_area(self, event)

    def eventFilter(self, watched, event) -> bool:  # noqa: N802 - Qt API
        # Bei optionalen leeren Daten steht intern das Minimum 01.01.1900.
        # Beim Öffnen des Kalenders soll trotzdem immer das aktuelle Jahr
        # angezeigt werden.
        if (
            isinstance(watched, QCalendarWidget)
            and event.type() == QEvent.Type.Show
            and self.date() == self.minimumDate()
        ):
            today = QDate.currentDate()
            watched.setCurrentPage(today.year(), today.month())
        return super().eventFilter(watched, event)


def create_date_edit(*, required: bool) -> QDateEdit:
    editor = NoWheelDateEdit()
    editor.setCalendarPopup(True)
    editor.setLocale(
        QLocale(QLocale.Language.German, QLocale.Country.Switzerland)
    )
    editor.setDisplayFormat("dd-MM-yyyy")
    editor.setMinimumDate(QDate(1900, 1, 1))
    editor.setSpecialValueText("" if required else "Kein Datum")
    editor.setDate(QDate.currentDate() if required else editor.minimumDate())

    palette = QPalette(editor.palette())
    for role, color in (
        (QPalette.ColorRole.Base, "#ffffff"),
        (QPalette.ColorRole.Text, "#111827"),
        (QPalette.ColorRole.Button, "#ffffff"),
        (QPalette.ColorRole.ButtonText, "#111827"),
        (QPalette.ColorRole.Highlight, "#cfe4ff"),
        (QPalette.ColorRole.HighlightedText, "#111827"),
    ):
        palette.setColor(role, QColor(color))
    editor.setPalette(palette)
    editor.setStyleSheet(
        """
        QDateEdit {
            min-height: 34px;
            padding-left: 8px;
            padding-right: 4px;
            background-color: #ffffff;
            color: #111827;
            border: 1px solid #c9d1d9;
            border-radius: 5px;
        }
        QDateEdit:focus { border: 1px solid #2f6fb7; }
        QDateEdit[inputError="true"] { border: 2px solid #c62828; }
        QDateEdit::drop-down {
            subcontrol-origin: padding;
            subcontrol-position: top right;
            width: 28px;
            background-color: #edf1f5;
            border-left: 1px solid #c9d1d9;
            border-top-right-radius: 5px;
            border-bottom-right-radius: 5px;
        }
        """
    )

    calendar = editor.calendarWidget()
    if isinstance(calendar, QCalendarWidget):
        calendar.installEventFilter(editor)
        calendar.setLocale(
            QLocale(QLocale.Language.German, QLocale.Country.Switzerland)
        )
        calendar.setFirstDayOfWeek(Qt.DayOfWeek.Monday)
        calendar.setGridVisible(True)

        calendar_palette = QPalette(calendar.palette())
        for role, color in (
            (QPalette.ColorRole.Window, "#ffffff"),
            (QPalette.ColorRole.WindowText, "#111827"),
            (QPalette.ColorRole.Base, "#ffffff"),
            (QPalette.ColorRole.AlternateBase, "#f4f6f8"),
            (QPalette.ColorRole.Text, "#111827"),
            (QPalette.ColorRole.Button, "#ffffff"),
            (QPalette.ColorRole.ButtonText, "#111827"),
            (QPalette.ColorRole.Highlight, "#cfe4ff"),
            (QPalette.ColorRole.HighlightedText, "#111827"),
        ):
            calendar_palette.setColor(role, QColor(color))
        calendar.setPalette(calendar_palette)
        calendar.setStyleSheet(
            """
            QCalendarWidget { background-color: #ffffff; color: #111827; }
            QCalendarWidget QWidget#qt_calendar_navigationbar {
                background-color: #edf1f5;
            }
            QCalendarWidget QToolButton {
                background-color: transparent;
                color: #111827;
                border: none;
                padding: 5px 7px;
                font-weight: 600;
            }
            QCalendarWidget QToolButton:hover {
                background-color: #dfe7ef;
                border-radius: 4px;
            }
            QCalendarWidget QSpinBox {
                background-color: #ffffff;
                color: #111827;
                border: 1px solid #c9d1d9;
                border-radius: 4px;
                padding: 3px 5px;
            }
            QCalendarWidget QTableView,
            QCalendarWidget QAbstractItemView:enabled {
                background-color: #ffffff;
                alternate-background-color: #f8fafb;
                color: #111827;
                selection-background-color: #cfe4ff;
                selection-color: #111827;
                gridline-color: #e5e7eb;
                outline: 0;
            }
            """
        )
    return editor


def parse_chf_decimal(value: str, label: str) -> Decimal:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{label} muss angegeben werden.")

    normalized = text.casefold().replace("chf", "").strip()
    normalized = normalized.replace("’", "'").replace("'", "").replace(" ", "")
    if normalized.endswith((".-", ",-")):
        normalized = normalized[:-2]
    normalized = normalized.rstrip("-").replace(",", ".")

    try:
        number = Decimal(normalized)
    except InvalidOperation as error:
        raise ValueError(
            f"{label} enthält keinen gültigen CHF-Betrag (z. B. CHF 100.-)."
        ) from error
    if number < 0:
        raise ValueError(f"{label} darf nicht negativ sein.")
    return number


def format_chf(number: Decimal) -> str:
    value = number.quantize(Decimal("0.01"))
    whole = int(value)
    whole_text = f"{whole:,}".replace(",", "'")
    cents = int((value - Decimal(whole)) * 100)
    return (
        f"CHF {whole_text}.-"
        if cents == 0
        else f"CHF {whole_text}.{cents:02d}"
    )

TRACKING_LABELS = {
    "serialized": "Einzelartikel",
    "quantity": "Mengenbestand",
    # Hybrid bleibt für bereits vorhandene Daten kompatibel, wird beim
    # Anlegen neuer Produktmodelle aber bewusst nicht mehr angeboten.
    "hybrid": "Hybrid",
}


class AssetCreateDialog(QDialog):
    """Dialog zum Anlegen eines neuen Inventareintrags.

    Der Dialog unterstützt sowohl serialisierte Assets als auch mengenbasierte
    Lagerbestände. Bei Bedarf kann direkt ein neues Produktmodell angelegt
    werden; Kategorien stammen bewusst aus dem bestehenden Katalog, weil dort
    auch das Spezifikationsschema definiert ist.
    """

    submit_requested = Signal(object)

    def __init__(
        self,
        form_data: dict[str, Any],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle("Neuer Inventareintrag")
        self.setObjectName("assetCreateDialog")

        # QDialog-Fenster erhalten unter Windows sonst je nach Plattform nur
        # die Schliessen-Schaltfläche. Die Window-Hints aktivieren explizit
        # Minimieren und Maximieren (Quadrat-Symbol), ohne die Modalität von
        # dialog.exec() zu verändern.
        flags = self.windowFlags()
        flags |= (
            Qt.WindowType.WindowSystemMenuHint
            | Qt.WindowType.WindowMinimizeButtonHint
            | Qt.WindowType.WindowMaximizeButtonHint
            | Qt.WindowType.WindowCloseButtonHint
        )
        self.setWindowFlags(flags)
        self.setSizeGripEnabled(True)

        # Nur den Inhalt dieses Dialogs mit einer hellen Palette absichern.
        # Keine globale App-Palette: Die native Windows-Titelleiste darf im
        # System-Dark-Mode weiterhin dunkel dargestellt werden.
        self._apply_content_palette()
        self.setStyleSheet(
            """
            QLineEdit[inputError="true"],
            QComboBox[inputError="true"],
            QDateEdit[inputError="true"] {
                border: 2px solid #c62828;
            }
            """
        )

        self.resize(760, 820)
        self.setMinimumSize(680, 650)

        self.form_data = form_data
        self.models = [row for row in form_data.get("product_models", []) if isinstance(row, dict)]
        self.categories = [row for row in form_data.get("product_categories", []) if isinstance(row, dict)]
        self.manufacturers = [row for row in form_data.get("manufacturers", []) if isinstance(row, dict)]
        self.sites = [row for row in form_data.get("sites", []) if isinstance(row, dict)]
        self.locations = [row for row in form_data.get("storage_locations", []) if isinstance(row, dict)]
        self.employees = [row for row in form_data.get("employees", []) if isinstance(row, dict)]
        self.departments = [row for row in form_data.get("departments", []) if isinstance(row, dict)]
        self.parent_assets = [row for row in form_data.get("parent_assets", []) if isinstance(row, dict)]

        self.categories_by_id = {
            row.get("id"): row for row in self.categories if row.get("id") is not None
        }
        self.manufacturers_by_id = {
            row.get("id"): row for row in self.manufacturers if row.get("id") is not None
        }
        self.sites_by_id = {
            row.get("id"): row for row in self.sites if row.get("id") is not None
        }

        self._spec_widgets: dict[str, tuple[dict[str, Any], QWidget]] = {}
        self._saving = False

        self._build_ui()
        self._populate_static_options()
        self._connect_signals()
        self._mode_changed()

    def _apply_content_palette(self) -> None:
        """Helle Widget-Palette nur für den Dialoginhalt.

        Das verhindert unlesbare Text-/Eingabefarben bei aktiviertem Windows
        Dark Mode, ohne die native Fensterdekoration oder gelöste QDockWidgets
        global auf hell umzuschalten.
        """

        palette = QPalette(self.palette())
        palette.setColor(QPalette.ColorRole.Window, QColor("#f4f6f8"))
        palette.setColor(QPalette.ColorRole.WindowText, QColor("#111827"))
        palette.setColor(QPalette.ColorRole.Base, QColor("#ffffff"))
        palette.setColor(QPalette.ColorRole.AlternateBase, QColor("#f8fafb"))
        palette.setColor(QPalette.ColorRole.ToolTipBase, QColor("#ffffff"))
        palette.setColor(QPalette.ColorRole.ToolTipText, QColor("#111827"))
        palette.setColor(QPalette.ColorRole.Text, QColor("#111827"))
        palette.setColor(QPalette.ColorRole.Button, QColor("#ffffff"))
        palette.setColor(QPalette.ColorRole.ButtonText, QColor("#111827"))
        palette.setColor(QPalette.ColorRole.BrightText, QColor("#ffffff"))
        palette.setColor(QPalette.ColorRole.Highlight, QColor("#cfe4ff"))
        palette.setColor(QPalette.ColorRole.HighlightedText, QColor("#111827"))
        palette.setColor(QPalette.ColorRole.PlaceholderText, QColor("#7a8490"))
        self.setPalette(palette)

    # ------------------------------------------------------------------
    # Aufbau
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        outer = QVBoxLayout(self)
        outer.setContentsMargins(12, 12, 12, 12)
        outer.setSpacing(10)

        scroll = QScrollArea(self)
        scroll.setObjectName("assetCreateScroll")
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)

        content = QWidget(scroll)
        content.setObjectName("assetCreateContent")
        content_layout = QVBoxLayout(content)
        content_layout.setContentsMargins(8, 8, 8, 8)
        content_layout.setSpacing(12)

        # Oberer Bereich: zwei Spalten nebeneinander. Links liegen die
        # Produkt-/Stammdaten, rechts die Daten des konkreten Inventareintrags.
        # Die dynamischen Spezifikationen folgen darunter über die ganze Breite.
        top_columns = QWidget(content)
        top_layout = QHBoxLayout(top_columns)
        top_layout.setContentsMargins(0, 0, 0, 0)
        top_layout.setSpacing(12)

        left_column = QWidget(top_columns)
        left_layout = QVBoxLayout(left_column)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(12)

        right_column = QWidget(top_columns)
        right_layout = QVBoxLayout(right_column)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(12)

        top_layout.addWidget(left_column, 1)
        top_layout.addWidget(right_column, 1)

        # Produktmodell -------------------------------------------------
        self.model_group = QGroupBox("Produktmodell")
        model_form = QFormLayout(self.model_group)
        model_form.setLabelAlignment(
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter
        )
        model_form.setFieldGrowthPolicy(
            QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow
        )

        self.model_mode_combo = NoWheelComboBox()
        self.model_mode_combo.addItem(
            "Vorhandenes Produktmodell verwenden", "existing"
        )
        self.model_mode_combo.addItem("Neues Produktmodell anlegen", "new")
        model_form.addRow("Auswahl:", self.model_mode_combo)

        self.existing_model_combo = NoWheelComboBox()
        self.existing_model_combo.setMinimumContentsLength(28)
        model_form.addRow("Produktmodell *:", self.existing_model_combo)

        self.model_info_label = QLabel()
        self.model_info_label.setWordWrap(True)
        self.model_info_label.setObjectName("dialogInfoBox")
        model_form.addRow("", self.model_info_label)

        self.category_combo = NoWheelComboBox()
        self.category_combo.setMinimumContentsLength(24)
        model_form.addRow("Produktkategorie *:", self.category_combo)

        self.model_name_input = QLineEdit()
        model_form.addRow("Bezeichnung *:", self.model_name_input)

        self.manufacturer_combo = NoWheelComboBox()
        self.manufacturer_combo.setEditable(True)
        self.manufacturer_combo.setInsertPolicy(QComboBox.InsertPolicy.NoInsert)
        model_form.addRow("Hersteller:", self.manufacturer_combo)

        self.tracking_combo = NoWheelComboBox()
        for key in ("serialized", "quantity"):
            self.tracking_combo.addItem(TRACKING_LABELS[key], key)
        model_form.addRow("Verwaltungsart *:", self.tracking_combo)

        left_layout.addWidget(self.model_group)

        # Dynamische Spezifikationen stehen direkt unter dem Produktmodell.
        self.spec_group = QGroupBox("Spezifikationen")
        self.spec_form = QFormLayout(self.spec_group)
        self.spec_form.setFieldGrowthPolicy(
            QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow
        )
        left_layout.addWidget(self.spec_group)

        # Eintragsart bleibt nur zur Kompatibilität für bereits vorhandene
        # Hybridmodelle erhalten. Neue Produktmodelle können nur Einzelartikel
        # oder Mengenbestand sein.
        self.entry_type_group = QGroupBox("Eintragsart")
        entry_type_form = QFormLayout(self.entry_type_group)
        self.entry_type_combo = NoWheelComboBox()
        self.entry_type_combo.addItem("Einzelnes Asset", "asset")
        self.entry_type_combo.addItem("Mengenbestand", "stock")
        entry_type_form.addRow("Für Hybrid-Modell:", self.entry_type_combo)
        left_layout.addWidget(self.entry_type_group)
        left_layout.addStretch()

        # Allgemeine Angaben gelten für Einzelartikel und Mengenbestand.
        self.common_group = QGroupBox("Allgemeine Angaben")
        common_form = QFormLayout(self.common_group)
        common_form.setFieldGrowthPolicy(
            QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow
        )

        self.status_combo = NoWheelComboBox()
        for key in ("available", "in_use", "defective", "in_repair"):
            self.status_combo.addItem(STATUS_LABELS.get(key, key), key)
        common_form.addRow("Status *:", self.status_combo)

        self.purchase_date_input = create_date_edit(required=True)
        common_form.addRow("Kaufdatum *:", self.purchase_date_input)

        self.new_price_input = QLineEdit()
        self.new_price_input.setPlaceholderText("CHF 0.-")
        self.new_price_input.editingFinished.connect(self._format_price_input)
        common_form.addRow("Neupreis:", self.new_price_input)

        right_layout.addWidget(self.common_group)

        # Allgemeine Assetdaten ----------------------------------------
        self.asset_group = QGroupBox("Einzelartikel")
        asset_form = QFormLayout(self.asset_group)
        asset_form.setFieldGrowthPolicy(
            QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow
        )

        self.asset_tag_input = QLineEdit()
        self.asset_tag_input.setPlaceholderText("z. B. IT-000123")
        asset_form.addRow("Produkterkennung *:", self.asset_tag_input)

        self.serial_number_input = QLineEdit()
        asset_form.addRow("Seriennummer:", self.serial_number_input)

        self.warranty_input = create_date_edit(required=False)
        asset_form.addRow("Garantie bis:", self.warranty_input)

        self.asset_note_input = QTextEdit()
        self.asset_note_input.setMinimumHeight(75)
        self.asset_note_input.setMaximumHeight(130)
        asset_form.addRow("Bemerkungen:", self.asset_note_input)

        right_layout.addWidget(self.asset_group)

        # Mengenbestand: IT-Material wird ausschliesslich in Stück geführt.
        self.stock_group = QGroupBox("Mengenbestand")
        stock_form = QFormLayout(self.stock_group)

        self.quantity_input = QLineEdit()
        self.quantity_input.setValidator(QIntValidator(1, 999999999, self))
        self.quantity_input.setPlaceholderText("leer = 1")
        stock_form.addRow("Menge [Stück] *:", self.quantity_input)

        self.stock_note_input = QTextEdit()
        self.stock_note_input.setMinimumHeight(65)
        self.stock_note_input.setMaximumHeight(110)
        stock_form.addRow("Bemerkungen:", self.stock_note_input)

        right_layout.addWidget(self.stock_group)

        # Zustand / Standort -------------------------------------------
        self.context_group = QGroupBox("Zustand und Standort")
        context_form = QFormLayout(self.context_group)

        self.condition_combo = NoWheelComboBox()
        for key in ("new", "like_new", "used", "defective"):
            self.condition_combo.addItem(CONDITION_LABELS.get(key, key), key)
        self.condition_combo.setCurrentIndex(
            self.condition_combo.findData("used")
        )
        context_form.addRow("Zustand *:", self.condition_combo)

        self.site_combo = NoWheelComboBox()
        context_form.addRow("Standort:", self.site_combo)

        self.location_combo = NoWheelComboBox()
        context_form.addRow("Lagerort *:", self.location_combo)

        self.department_combo = NoWheelComboBox()
        context_form.addRow("Abteilung *:", self.department_combo)

        self.parent_asset_combo = NoWheelComboBox()
        context_form.addRow("Verbunden mit:", self.parent_asset_combo)

        self.employee_combo = NoWheelComboBox()
        context_form.addRow("Mitarbeiter:", self.employee_combo)

        right_layout.addWidget(self.context_group)
        right_layout.addStretch()

        content_layout.addWidget(top_columns)
        content_layout.addStretch()
        scroll.setWidget(content)
        outer.addWidget(scroll, 1)

        self.button_box = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save
            | QDialogButtonBox.StandardButton.Cancel
        )
        self.save_button = self.button_box.button(
            QDialogButtonBox.StandardButton.Save
        )
        self.cancel_button = self.button_box.button(
            QDialogButtonBox.StandardButton.Cancel
        )
        self.save_button.setText("Eintrag speichern")
        self.cancel_button.setText("Abbrechen")
        self.save_button.setObjectName("primaryButton")
        outer.addWidget(self.button_box)

    def _populate_static_options(self) -> None:
        # Die Artikelart ist der fachliche Einstieg in den Dialog. Dadurch
        # werden sowohl die verfügbaren Produktmodelle als auch die
        # Spezifikationsfelder direkt nach Computer, Monitor, Laptop usw.
        # gefiltert.
        self.category_combo.clear()
        for category in sorted(
            self.categories,
            key=lambda row: self._category_label(row).casefold(),
        ):
            self.category_combo.addItem(
                self._category_label(category),
                category.get("id"),
            )

        self._repopulate_existing_models()

        self.manufacturer_combo.clear()
        self.manufacturer_combo.addItem("Keiner", None)
        for manufacturer in sorted(
            self.manufacturers,
            key=lambda row: str(row.get("name") or "").casefold(),
        ):
            self.manufacturer_combo.addItem(
                str(manufacturer.get("name") or ""),
                manufacturer.get("id"),
            )
        self.manufacturer_combo.setCurrentIndex(0)

        self.site_combo.clear()
        self.site_combo.addItem("Kein Standort", None)
        sites = self.sites
        if not sites:
            # Rückwärtskompatibilität, falls ein älteres Repository noch keine
            # site-Datensätze an den Dialog liefert.
            site_ids = sorted(
                {row.get("site_id") for row in self.locations if row.get("site_id") is not None},
                key=str,
            )
            sites = [{"id": site_id, "name": f"Standort #{site_id}"} for site_id in site_ids]
        for site in sorted(sites, key=lambda row: str(row.get("name") or "").casefold()):
            self.site_combo.addItem(
                str(site.get("name") or f"Standort #{site.get('id')}"),
                site.get("id"),
            )

        self._repopulate_locations()

        self.department_combo.clear()
        self.department_combo.addItem("Bitte Abteilung auswählen *", None)
        for department in sorted(
            self.departments,
            key=lambda row: str(row.get("name") or "").casefold(),
        ):
            self.department_combo.addItem(
                str(department.get("name") or f"Abteilung #{department.get('id')}"),
                department.get("id"),
            )

        self._repopulate_employees(preserve_selection=False)

        self.parent_asset_combo.clear()
        self.parent_asset_combo.addItem("Nicht verbunden", None)
        for asset in sorted(
            self.parent_assets,
            key=lambda row: str(row.get("label") or "").casefold(),
        ):
            self.parent_asset_combo.addItem(
                str(asset.get("label") or f"Asset #{asset.get('id')}"),
                asset.get("id"),
            )

    def _connect_signals(self) -> None:
        self.model_mode_combo.currentIndexChanged.connect(self._mode_changed)
        self.existing_model_combo.currentIndexChanged.connect(self._model_changed)
        self.category_combo.currentIndexChanged.connect(self._category_changed)
        self.tracking_combo.currentIndexChanged.connect(self._tracking_changed)
        self.entry_type_combo.currentIndexChanged.connect(self._entry_type_changed)
        self.site_combo.currentIndexChanged.connect(self._site_changed)
        self.employee_combo.currentIndexChanged.connect(self._employee_assignment_changed)
        self.department_combo.currentIndexChanged.connect(self._department_assignment_changed)
        self.button_box.accepted.connect(self._submit)
        self.button_box.rejected.connect(self.reject)

        for widget in self._required_validation_widgets():
            if isinstance(widget, QLineEdit):
                widget.textChanged.connect(
                    lambda _value, current=widget: self._set_validation_error(current, False)
                )
            elif isinstance(widget, QComboBox):
                widget.currentIndexChanged.connect(
                    lambda _index, current=widget: self._set_validation_error(current, False)
                )
            elif isinstance(widget, QDateEdit):
                widget.dateChanged.connect(
                    lambda _date, current=widget: self._set_validation_error(current, False)
                )

    # ------------------------------------------------------------------
    # Dynamisches Verhalten
    # ------------------------------------------------------------------

    def _mode_changed(self) -> None:
        is_new = self.model_mode_combo.currentData() == "new"

        self.existing_model_combo.setVisible(not is_new)
        self.model_info_label.setVisible(not is_new)

        # Die Artikelart bleibt in beiden Modi sichtbar. Sie filtert bei
        # bestehenden Modellen die Modellauswahl und steuert bei neuen Modellen
        # direkt das dynamische Spezifikationsschema.
        new_model_fields = (
            self.manufacturer_combo,
            self.model_name_input,
            self.tracking_combo,
        )
        for field in new_model_fields:
            self._set_form_row_visible(field, is_new)

        # QFormLayout blendet Labels nicht automatisch mit dem Feld aus.
        self._set_form_row_visible(self.existing_model_combo, not is_new)
        self._set_form_row_visible(self.model_info_label, not is_new)

        if is_new:
            self._category_changed()
            self._tracking_changed()
        else:
            self._repopulate_existing_models()
            self._model_changed()

    def _repopulate_existing_models(self) -> None:
        """Zeigt nur Produktmodelle der aktuell gewählten Artikelart."""

        selected_model = self._current_existing_model()
        selected_id = selected_model.get("id") if selected_model else None
        category_id = self.category_combo.currentData()

        self.existing_model_combo.blockSignals(True)
        self.existing_model_combo.clear()

        active_models = [
            row
            for row in self.models
            if row.get("is_active", True)
            and row.get("category_id") == category_id
        ]

        restore_index = -1
        for model in sorted(active_models, key=self._model_sort_key):
            manufacturer = self.manufacturers_by_id.get(
                model.get("manufacturer_id"),
                {},
            )
            manufacturer_name = str(manufacturer.get("name") or "").strip()
            model_name = str(model.get("name") or "Unbenannt").strip()
            label = " · ".join(
                part
                for part in (manufacturer_name, model_name)
                if part
            )
            self.existing_model_combo.addItem(label or model_name, model)
            if selected_id is not None and model.get("id") == selected_id:
                restore_index = self.existing_model_combo.count() - 1

        if restore_index >= 0:
            self.existing_model_combo.setCurrentIndex(restore_index)

        self.existing_model_combo.blockSignals(False)

        has_models = self.existing_model_combo.count() > 0
        self.existing_model_combo.setEnabled(has_models)
        if not has_models:
            self.model_info_label.setText(
                "Für diese Artikelart ist noch kein aktives Produktmodell "
                "vorhanden. Wähle 'Neues Produktmodell anlegen'."
            )

    def _model_changed(self) -> None:
        if self.model_mode_combo.currentData() != "existing":
            return

        model = self._current_existing_model()
        if not model:
            self.model_info_label.setText(
                "Für diese Artikelart ist kein aktives Produktmodell vorhanden."
            )
            self._rebuild_specifications()
            return

        category = self.categories_by_id.get(model.get("category_id"), {})
        manufacturer = self.manufacturers_by_id.get(model.get("manufacturer_id"), {})
        tracking = str(model.get("tracking_mode") or "serialized")
        details = [
            f"Kategorie: {self._category_label(category)}",
            f"Hersteller: {manufacturer.get('name') or '—'}",
            f"Verwaltungsart: {TRACKING_LABELS.get(tracking, tracking)}",
        ]
        self.model_info_label.setText("\n".join(details))

        self._tracking_changed()
        self._rebuild_specifications()
        self._update_parent_asset_visibility()

    def _category_changed(self) -> None:
        # Die Kategorie/Artikelart bestimmt die zulässigen Produktmodelle und
        # das specification_schema. Ein Wechsel von z. B. Computer zu Monitor
        # baut deshalb die Spezifikationsfelder sofort neu auf.
        if self.model_mode_combo.currentData() == "existing":
            self._repopulate_existing_models()
            self._model_changed()
        else:
            self._rebuild_specifications()
            self._update_parent_asset_visibility()

    def _tracking_changed(self) -> None:
        tracking = self._current_tracking_mode()
        is_hybrid = tracking == "hybrid"
        self.entry_type_group.setVisible(is_hybrid)
        self._entry_type_changed()

    def _entry_type_changed(self) -> None:
        entry_type = self._current_entry_type()
        is_asset = entry_type == "asset"

        self.asset_group.setVisible(is_asset)
        self.stock_group.setVisible(not is_asset)
        self.employee_combo.setEnabled(is_asset)
        self.department_combo.setEnabled(True)
        self.parent_asset_combo.setEnabled(is_asset)

        # Ein Lagerort ist für jede Eintragsart zwingend.
        self.location_combo.setItemText(0, "Bitte Lagerort auswählen *")

        self._rebuild_specifications()
        self._update_parent_asset_visibility()

    def _site_changed(self) -> None:
        self._repopulate_locations()

    def _repopulate_locations(self) -> None:
        selected_location_id = self.location_combo.currentData() if self.location_combo.count() else None
        site_id = self.site_combo.currentData() if hasattr(self, "site_combo") else None

        self.location_combo.blockSignals(True)
        self.location_combo.clear()
        self.location_combo.addItem("Bitte Lagerort auswählen *", None)

        active_locations = [
            row for row in self.locations
            if row.get("is_active", True)
            and (site_id is None or row.get("site_id") == site_id)
        ]
        restore_index = 0
        for location in sorted(active_locations, key=lambda row: str(row.get("name") or "").casefold()):
            name = str(location.get("name") or f"Lagerort #{location.get('id')}")
            code = str(location.get("code") or "").strip()
            label = f"{name} ({code})" if code else name
            self.location_combo.addItem(label, location.get("id"))
            if location.get("id") == selected_location_id:
                restore_index = self.location_combo.count() - 1

        self.location_combo.setCurrentIndex(restore_index)
        self.location_combo.blockSignals(False)

    def _employee_assignment_changed(self) -> None:
        """Übernimmt bei Bedarf automatisch die Abteilung des Mitarbeiters."""

        employee_id = self.employee_combo.currentData()
        if employee_id is None:
            return

        employee = next(
            (row for row in self.employees if row.get("id") == employee_id),
            None,
        )
        if not isinstance(employee, dict):
            return

        employee_department_id = employee.get("department_id")
        if employee_department_id is None:
            return

        # Ist noch keine Abteilung gewählt, wird die Abteilung des Mitarbeiters
        # automatisch ergänzt. Bei bereits gewählter Abteilung werden durch die
        # Filterung ohnehin nur passende Mitarbeiter angeboten.
        if self.department_combo.currentData() is None:
            index = self.department_combo.findData(employee_department_id)
            if index >= 0:
                self.department_combo.blockSignals(True)
                self.department_combo.setCurrentIndex(index)
                self.department_combo.blockSignals(False)
                self._repopulate_employees(
                    preserve_selection=True,
                    preferred_employee_id=employee_id,
                )

    def _department_assignment_changed(self) -> None:
        # Eine Abteilung und ein Mitarbeiter dürfen gleichzeitig gesetzt sein.
        # Bei gewählter Abteilung zeigt das Mitarbeiterfeld nur Personen dieser
        # Abteilung; bei "keine" stehen wieder alle aktiven Mitarbeiter bereit.
        self._repopulate_employees(preserve_selection=True)

    def _repopulate_employees(
        self,
        *,
        preserve_selection: bool = True,
        preferred_employee_id: Any | None = None,
    ) -> None:
        if not hasattr(self, "employee_combo"):
            return

        selected_id = (
            preferred_employee_id
            if preferred_employee_id is not None
            else (self.employee_combo.currentData() if preserve_selection else None)
        )
        department_id = (
            self.department_combo.currentData()
            if hasattr(self, "department_combo")
            else None
        )

        self.employee_combo.blockSignals(True)
        self.employee_combo.clear()
        self.employee_combo.addItem("Keine Mitarbeiterzuweisung", None)

        employees = [
            row
            for row in self.employees
            if row.get("is_active", True)
            and (
                department_id is None
                or row.get("department_id") == department_id
            )
        ]

        restore_index = 0
        for employee in sorted(
            employees,
            key=lambda row: (
                str(row.get("last_name") or "").casefold(),
                str(row.get("first_name") or "").casefold(),
            ),
        ):
            full_name = " ".join(
                part
                for part in (
                    str(employee.get("first_name") or "").strip(),
                    str(employee.get("last_name") or "").strip(),
                )
                if part
            )
            self.employee_combo.addItem(
                full_name or f"Mitarbeiter #{employee.get('id')}",
                employee.get("id"),
            )
            if employee.get("id") == selected_id:
                restore_index = self.employee_combo.count() - 1

        self.employee_combo.setCurrentIndex(restore_index)
        self.employee_combo.blockSignals(False)

    def _update_parent_asset_visibility(self) -> None:
        category = self._current_category()
        is_component = str(category.get("inventory_group") or "") == "component"
        visible = is_component and self._current_entry_type() == "asset"
        self.parent_asset_combo.setVisible(visible)
        self._set_form_row_visible(self.parent_asset_combo, visible)

    def _rebuild_specifications(self) -> None:
        while self.spec_form.rowCount():
            self.spec_form.removeRow(0)
        self._spec_widgets.clear()

        category = self._current_category()
        category_label = self._category_label(category) if category else "Artikelart"
        self.spec_group.setTitle(f"Spezifikationen – {category_label}")

        fields = get_specification_fields(category.get("specification_schema"))
        if not fields:
            self.spec_form.addRow(QLabel("Für diese Kategorie sind keine Spezifikationsfelder definiert."))
            return

        existing_model = self._current_existing_model() if self.model_mode_combo.currentData() == "existing" else None
        model_specs = normalize_specifications(
            existing_model.get("specifications") if existing_model else {}
        )
        entry_type = self._current_entry_type()
        is_new_model = self.model_mode_combo.currentData() == "new"

        shown = 0
        for field in fields:
            key = normalize_specification_key(str(field.get("key") or ""))
            if not key:
                continue
            scope = str(field.get("scope") or "model").strip().casefold()

            if scope == "model" and not is_new_model:
                label = self._spec_label(field, "Modell")
                value = model_specs.get(key)
                value_label = QLabel(self._display_spec_value(value))
                value_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
                self.spec_form.addRow(label + ":", value_label)
                shown += 1
                continue

            if scope == "asset" and entry_type != "asset":
                continue

            widget = self._create_spec_editor(field)
            suffix = "Modell" if scope == "model" else "Asset"
            self.spec_form.addRow(self._spec_label(field, suffix) + ":", widget)
            self._spec_widgets[key] = (field, widget)
            shown += 1

        if shown == 0:
            self.spec_form.addRow(QLabel("Für diese Eintragsart sind keine zusätzlichen Spezifikationen nötig."))

    # ------------------------------------------------------------------
    # Speichern / Validierung
    # ------------------------------------------------------------------

    def _submit(self) -> None:
        if self._saving:
            return

        self._clear_validation_errors()
        missing = self._missing_required_fields()
        if missing:
            for _label, widget in missing:
                self._set_validation_error(widget, True)

            field_list = "\n".join(f"• {label}" for label, _widget in missing)
            QMessageBox.warning(
                self,
                "Eingaben prüfen",
                "Folgende Pflichtfelder müssen noch ausgefüllt werden:\n\n"
                f"{field_list}",
            )
            missing[0][1].setFocus(Qt.FocusReason.OtherFocusReason)
            return

        try:
            payload = self._build_payload()
        except ValueError as error:
            QMessageBox.warning(self, "Eingaben prüfen", str(error))
            return

        self.set_saving(True)
        self.submit_requested.emit(payload)

    def _missing_required_fields(self) -> list[tuple[str, QWidget]]:
        """Liefert alle aktuell sichtbaren, noch leeren Pflichtfelder."""

        missing: list[tuple[str, QWidget]] = []
        model_mode = str(self.model_mode_combo.currentData())
        entry_type = self._current_entry_type()

        if self.category_combo.currentData() is None:
            missing.append(("Produktkategorie", self.category_combo))

        if model_mode == "existing":
            if self._current_existing_model() is None:
                missing.append(("Produktmodell", self.existing_model_combo))
        elif not self.model_name_input.text().strip():
            missing.append(("Bezeichnung (Produktmodell)", self.model_name_input))

        if not str(self._current_tracking_mode() or "").strip():
            missing.append(("Verwaltungsart", self.tracking_combo))

        if entry_type == "asset" and not self.asset_tag_input.text().strip():
            missing.append(("Produkterkennung", self.asset_tag_input))

        if not str(self.condition_combo.currentData() or "").strip():
            missing.append(("Zustand", self.condition_combo))

        if self.location_combo.currentData() is None:
            missing.append(("Lagerort", self.location_combo))

        if self.department_combo.currentData() is None:
            missing.append(("Abteilung", self.department_combo))

        if not str(self.status_combo.currentData() or "").strip():
            missing.append(("Status", self.status_combo))

        if (
            not self.purchase_date_input.date().isValid()
            or self.purchase_date_input.date() == self.purchase_date_input.minimumDate()
        ):
            missing.append(("Kaufdatum", self.purchase_date_input))

        return missing

    def _required_validation_widgets(self) -> tuple[QWidget, ...]:
        return (
            self.category_combo,
            self.existing_model_combo,
            self.model_name_input,
            self.tracking_combo,
            self.asset_tag_input,
            self.condition_combo,
            self.location_combo,
            self.department_combo,
            self.status_combo,
            self.purchase_date_input,
        )

    def _clear_validation_errors(self) -> None:
        for widget in self._required_validation_widgets():
            self._set_validation_error(widget, False)

    @staticmethod
    def _set_validation_error(widget: QWidget, invalid: bool) -> None:
        if widget.property("inputError") == invalid:
            return
        widget.setProperty("inputError", invalid)
        widget.style().unpolish(widget)
        widget.style().polish(widget)
        widget.update()

    def _build_payload(self) -> dict[str, Any]:
        model_mode = str(self.model_mode_combo.currentData())
        entry_type = self._current_entry_type()
        tracking_mode = self._current_tracking_mode()

        if model_mode == "existing":
            model = self._current_existing_model() or {}
            model_payload: dict[str, Any] = {
                "mode": "existing",
                "id": model.get("id"),
                "tracking_mode": tracking_mode,
                "unit_code": model.get("unit_code") or "piece",
            }
        else:
            category_id = self.category_combo.currentData()
            manufacturer_id, manufacturer_name = self._manufacturer_selection()
            if manufacturer_id is None and not manufacturer_name:
                manufacturer_name = "Keiner"

            model_name = self.model_name_input.text().strip()
            model_specs = self._collect_specifications(scope="model")
            model_payload = {
                "mode": "new",
                "category_id": category_id,
                "manufacturer_id": manufacturer_id,
                "manufacturer_name": manufacturer_name,
                "name": model_name,
                "tracking_mode": tracking_mode,
                "unit_code": "piece",
                "specifications": model_specs,
            }

        condition = str(self.condition_combo.currentData() or "").strip()
        location_id = self.location_combo.currentData()
        department_id = self.department_combo.currentData()
        status = str(self.status_combo.currentData() or "").strip()

        purchase_date = self.purchase_date_input.date().toString(Qt.DateFormat.ISODate)
        new_price = self._optional_decimal(self.new_price_input.text(), "Neupreis")
        if new_price is None:
            new_price = 0.0

        payload: dict[str, Any] = {
            "model": model_payload,
            "entry_type": entry_type,
            "condition": condition,
            "storage_location_id": location_id,
        }

        if entry_type == "asset":
            asset_tag = self.asset_tag_input.text().strip()
            warranty_until = self._optional_date_value(self.warranty_input)

            payload["asset"] = {
                "asset_tag": asset_tag,
                "serial_number": self._none_if_blank(self.serial_number_input.text()),
                "status": status,
                "purchase_date": purchase_date,
                "new_price": new_price,
                "warranty_until": warranty_until,
                "retired_at": None,
                "note": self._none_if_blank(self.asset_note_input.toPlainText()),
                "specifications": self._collect_specifications(scope="asset"),
            }
            payload["assignment"] = {
                "employee_id": self.employee_combo.currentData(),
                "department_id": department_id,
            }
            payload["parent_asset_id"] = self.parent_asset_combo.currentData()
        else:
            quantity_text = self.quantity_input.text().strip()
            quantity = 1.0 if not quantity_text else self._positive_decimal(quantity_text, "Menge")
            payload["stock"] = {
                "quantity": quantity,
                "department_id": department_id,
                "status": status,
                "purchase_date": purchase_date,
                "new_price": new_price,
                "note": self._none_if_blank(self.stock_note_input.toPlainText()),
            }

        return payload

    def set_saving(self, saving: bool) -> None:
        self._saving = saving
        self.save_button.setEnabled(not saving)
        self.cancel_button.setEnabled(not saving)
        self.save_button.setText("Wird gespeichert ..." if saving else "Eintrag speichern")

    def reject(self) -> None:
        if self._saving:
            return
        super().reject()

    # ------------------------------------------------------------------
    # Hilfsfunktionen
    # ------------------------------------------------------------------

    def _current_existing_model(self) -> dict[str, Any] | None:
        value = self.existing_model_combo.currentData()
        return value if isinstance(value, dict) else None

    def _current_category(self) -> dict[str, Any]:
        return self.categories_by_id.get(
            self.category_combo.currentData(),
            {},
        )

    def _current_tracking_mode(self) -> str:
        if self.model_mode_combo.currentData() == "existing":
            model = self._current_existing_model() or {}
            return str(model.get("tracking_mode") or "serialized")
        return str(self.tracking_combo.currentData() or "serialized")

    def _current_entry_type(self) -> str:
        tracking = self._current_tracking_mode()
        if tracking == "quantity":
            return "stock"
        if tracking == "serialized":
            return "asset"
        return str(self.entry_type_combo.currentData() or "asset")

    def _manufacturer_selection(self) -> tuple[Any | None, str | None]:
        text = self.manufacturer_combo.currentText().strip()
        if not text:
            return None, None

        for index in range(self.manufacturer_combo.count()):
            if self.manufacturer_combo.itemText(index).strip().casefold() == text.casefold():
                return self.manufacturer_combo.itemData(index), text
        return None, text

    def _collect_specifications(self, *, scope: str) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, (field, widget) in self._spec_widgets.items():
            field_scope = str(field.get("scope") or "model").strip().casefold()
            if field_scope != scope:
                continue
            value = self._spec_editor_value(field, widget)
            if value is not None:
                result[key] = value
        return result

    def _create_spec_editor(self, field: dict[str, Any]) -> QWidget:
        field_type = str(field.get("type") or "text").strip().casefold()
        if field_type == "boolean":
            combo = NoWheelComboBox()
            combo.addItem("Nicht gesetzt", None)
            combo.addItem("Ja", True)
            combo.addItem("Nein", False)
            return combo

        line = QLineEdit()
        if field_type == "integer":
            line.setValidator(QIntValidator(-2147483648, 2147483647, line))
        elif field_type == "number":
            validator = QDoubleValidator(-999999999.0, 999999999.0, 6, line)
            validator.setNotation(QDoubleValidator.Notation.StandardNotation)
            line.setValidator(validator)
        return line

    def _spec_editor_value(self, field: dict[str, Any], widget: QWidget) -> Any:
        field_type = str(field.get("type") or "text").strip().casefold()
        label = str(field.get("label") or field.get("key") or "Spezifikation")

        if isinstance(widget, QComboBox):
            return widget.currentData()
        if not isinstance(widget, QLineEdit):
            return None

        text = widget.text().strip()
        if not text:
            return None
        if field_type == "integer":
            try:
                return int(text)
            except ValueError as error:
                raise ValueError(f"'{label}' muss eine ganze Zahl sein.") from error
        if field_type == "number":
            try:
                return float(text.replace(",", "."))
            except ValueError as error:
                raise ValueError(f"'{label}' muss eine Zahl sein.") from error
        return text

    @staticmethod
    def _spec_label(field: dict[str, Any], scope_label: str) -> str:
        label = str(field.get("label") or field.get("key") or "Spezifikation")
        unit = str(field.get("unit") or "").strip()
        base = f"{label} [{unit}]" if unit else label
        return f"{base} ({scope_label})"

    @staticmethod
    def _display_spec_value(value: Any) -> str:
        if value is None or value == "":
            return "—"
        if isinstance(value, bool):
            return "Ja" if value else "Nein"
        return str(value)

    @staticmethod
    def _category_label(category: dict[str, Any]) -> str:
        code = str(category.get("code") or "").strip().casefold()
        return CATEGORY_LABELS.get(code, str(category.get("name") or "Unbekannte Kategorie"))

    @staticmethod
    def _model_sort_key(model: dict[str, Any]) -> tuple[str, str]:
        return (
            str(model.get("category_id") or ""),
            str(model.get("name") or "").casefold(),
        )

    @staticmethod
    def _none_if_blank(value: str) -> str | None:
        text = str(value or "").strip()
        return text or None

    @staticmethod
    def _optional_date_value(editor: QDateEdit) -> str | None:
        if editor.date() == editor.minimumDate():
            return None
        return editor.date().toString(Qt.DateFormat.ISODate)

    def _format_price_input(self) -> None:
        text = self.new_price_input.text().strip()
        if not text:
            return
        try:
            number = parse_chf_decimal(text, "Neupreis")
        except ValueError:
            return
        self.new_price_input.setText(format_chf(number))

    @classmethod
    def _optional_decimal(cls, value: str, label: str) -> float | None:
        text = str(value or "").strip()
        if not text:
            return None
        return float(parse_chf_decimal(text, label))

    @staticmethod
    def _positive_decimal(value: str, label: str) -> float:
        text = str(value or "").strip().replace(",", ".")
        if not text:
            raise ValueError(f"{label} muss angegeben werden.")
        try:
            number = Decimal(text)
        except InvalidOperation as error:
            raise ValueError(f"{label} enthält keine gültige Zahl.") from error
        if number <= 0:
            raise ValueError(f"{label} muss grösser als 0 sein.")
        return float(number)

    def _set_form_row_visible(self, field: QWidget, visible: bool) -> None:
        form = field.parentWidget().layout() if field.parentWidget() is not None else None
        if not isinstance(form, QFormLayout):
            # parentWidget kann bei Layouts je nach Qt-Version auf die GroupBox
            # zeigen; deshalb die bekannten Form-Layouts durchsuchen.
            forms = [
                self.model_group.layout(),
                self.context_group.layout(),
            ]
        else:
            forms = [form]

        for candidate in forms:
            if not isinstance(candidate, QFormLayout):
                continue
            for row in range(candidate.rowCount()):
                field_item = candidate.itemAt(row, QFormLayout.ItemRole.FieldRole)
                if field_item is None or field_item.widget() is not field:
                    continue
                label_item = candidate.itemAt(row, QFormLayout.ItemRole.LabelRole)
                if label_item is not None and label_item.widget() is not None:
                    label_item.widget().setVisible(visible)
                field.setVisible(visible)
                return