from __future__ import annotations

import json
from typing import Any

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDockWidget,
    QFrame,
    QGridLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from inventory import (
    HEADER_LABELS,
    SPECIFICATION_COLUMN_PREFIX,
    format_inventory_value,
    get_asset_identifier,
    is_specification_column,
    is_stock_record,
)


GENERAL_DETAIL_FIELDS = (
    "asset_tag",
    "serial_number",
    "product_model_name",
    "manufacturer_name",
    "product_category_name",
    "condition",
    "stock_quantity",
    "department_name",
    "storage_location",
    "connected_product",
    "status",
    "product_model_part_number",
    "purchase_date",
    "new_price",
    "warranty_until",
    "note",
)


class AssetDetailSidebar(QDockWidget):
    FIELD_LABEL_WIDTH = 170

    """Andockbare Detailansicht für ein oder mehrere ausgewählte Assets.

    Ein Asset:
        Zeigt die vorhandenen allgemeinen Daten und alle definierten
        Spezifikationen.

    Mehrere Assets:
        Zeigt ausschließlich Werte, die bei ALLEN ausgewählten Assets
        vorhanden und identisch sind. Unterschiedliche oder leere Werte
        werden bewusst weggelassen.
    """

    def __init__(self, parent=None) -> None:
        super().__init__("Detailansicht", parent)
        self.setObjectName("assetDetailSidebar")
        self.setAllowedAreas(
            Qt.DockWidgetArea.LeftDockWidgetArea
            | Qt.DockWidgetArea.RightDockWidgetArea
        )
        self.setFeatures(
            QDockWidget.DockWidgetFeature.DockWidgetMovable
            | QDockWidget.DockWidgetFeature.DockWidgetFloatable
            | QDockWidget.DockWidgetFeature.DockWidgetClosable
        )
        self.setMinimumWidth(380)

        self._root = QWidget(self)
        self._root.setObjectName("detailRoot")
        root_layout = QVBoxLayout(self._root)
        root_layout.setContentsMargins(14, 14, 14, 14)
        root_layout.setSpacing(10)

        self.selection_title = QLabel("Kein Asset ausgewählt")
        self.selection_title.setObjectName("detailSelectionTitle")
        self.selection_title.setWordWrap(True)

        self.selection_hint = QLabel(
            "Wähle ein Asset in der Tabelle aus, um Details anzuzeigen."
        )
        self.selection_hint.setObjectName("detailSelectionHint")
        self.selection_hint.setWordWrap(True)

        root_layout.addWidget(self.selection_title)
        root_layout.addWidget(self.selection_hint)

        separator = QFrame()
        separator.setObjectName("detailSeparator")
        separator.setFrameShape(QFrame.Shape.HLine)
        separator.setFrameShadow(QFrame.Shadow.Sunken)
        root_layout.addWidget(separator)

        self.scroll_area = QScrollArea()
        self.scroll_area.setObjectName("detailScrollArea")
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setFrameShape(QFrame.Shape.NoFrame)

        self.details_widget = QWidget()
        self.details_widget.setObjectName("detailDetailsWidget")
        self.details_layout = QVBoxLayout(self.details_widget)
        self.details_layout.setContentsMargins(0, 0, 0, 0)
        self.details_layout.setSpacing(10)
        self.details_layout.addStretch()

        self.scroll_area.setWidget(self.details_widget)
        root_layout.addWidget(self.scroll_area, 1)

        self.setWidget(self._root)
        self.set_assets([])

    def set_assets(self, assets: list[dict[str, Any]]) -> None:
        """Aktualisiert die Detailansicht anhand der aktuellen Auswahl."""

        self._clear_details()

        valid_assets = [
            asset for asset in assets
            if isinstance(asset, dict)
        ]

        if not valid_assets:
            self.selection_title.setText("Kein Asset ausgewählt")
            self.selection_hint.setText(
                "Wähle ein Asset in der Tabelle aus, um Details anzuzeigen."
            )
            self._show_empty_message(
                "Keine Details verfügbar."
            )
            return

        if len(valid_assets) == 1:
            asset = valid_assets[0]
            self.selection_title.setText(get_asset_identifier(asset))

            model_name = self._display_text(
                "product_model_name",
                asset.get("product_model_name"),
            )
            category_name = self._display_text(
                "product_category_name",
                asset.get("product_category_name"),
            )
            summary_parts = [
                part for part in (model_name, category_name)
                if part
            ]
            if is_stock_record(asset):
                summary_parts.insert(0, "Lagerartikel")

            self.selection_hint.setText(
                " · ".join(summary_parts)
                if summary_parts
                else "1 Eintrag ausgewählt"
            )

            general_rows = self._single_general_rows(asset)
            specification_rows = self._single_specification_rows(asset)
        else:
            self.selection_title.setText(
                f"{len(valid_assets)} Einträge ausgewählt"
            )
            self.selection_hint.setText(
                "Es werden nur Werte angezeigt, die bei allen "
                "ausgewählten Einträgen gleich sind."
            )

            general_rows = self._common_general_rows(valid_assets)
            specification_rows = self._common_specification_rows(valid_assets)

        if general_rows:
            self._add_section("Allgemein", general_rows)

        if specification_rows:
            self._add_section("Spezifikationen", specification_rows)
        else:
            if len(valid_assets) == 1:
                self._add_info_section(
                    "Spezifikationen",
                    "Für diese Produktkategorie ist noch kein "
                    "Spezifikationsschema definiert.",
                )
            else:
                self._add_info_section(
                    "Spezifikationen",
                    "Keine identischen Spezifikationswerte bei allen "
                    "ausgewählten Einträgen vorhanden.",
                )

        if not general_rows and not specification_rows:
            self._show_empty_message(
                "Für die aktuelle Auswahl sind keine gemeinsamen Details vorhanden."
            )

    # ------------------------------------------------------------------
    # Einzelauswahl
    # ------------------------------------------------------------------

    def _single_general_rows(
        self,
        asset: dict[str, Any],
    ) -> list[tuple[str, str]]:
        rows: list[tuple[str, str]] = []

        for field_name in GENERAL_DETAIL_FIELDS:
            value = asset.get(field_name)
            if self._is_empty(value):
                continue

            rows.append(
                (
                    HEADER_LABELS.get(
                        field_name,
                        field_name.replace("_", " ").title(),
                    ),
                    self._display_text(field_name, value),
                )
            )

        return rows

    def _single_specification_rows(
        self,
        asset: dict[str, Any],
    ) -> list[tuple[str, str]]:
        """Zeigt bei Einzelauswahl alle für die Kategorie definierten Felder.

        Auch noch leere Spezifikationen werden dargestellt. Dadurch ist sofort
        sichtbar, welche technischen Daten für den Produkttyp vorgesehen sind.
        """

        labels = asset.get("_specification_labels")
        if not isinstance(labels, dict):
            labels = {}

        rows: list[tuple[str, str]] = []

        # Das Repository legt die spec_* Felder in der Reihenfolge des
        # specification_schema in das Asset-Dictionary.
        for field_name, value in asset.items():
            if not is_specification_column(field_name):
                continue

            label = str(
                labels.get(field_name)
                or field_name[len(SPECIFICATION_COLUMN_PREFIX):]
                .replace("_", " ")
                .title()
            )

            display_value = (
                "Keine"
                if (
                    self._is_empty(value)
                    or self._is_placeholder_specification_value(value)
                )
                else self._display_text(field_name, value)
            )

            rows.append(
                (
                    label,
                    display_value,
                )
            )

        return rows

    # ------------------------------------------------------------------
    # Mehrfachauswahl
    # ------------------------------------------------------------------

    def _common_general_rows(
        self,
        assets: list[dict[str, Any]],
    ) -> list[tuple[str, str]]:
        rows: list[tuple[str, str]] = []

        for field_name in GENERAL_DETAIL_FIELDS:
            common_value = self._common_nonempty_value(
                [asset.get(field_name) for asset in assets]
            )
            if common_value is None:
                continue

            rows.append(
                (
                    HEADER_LABELS.get(
                        field_name,
                        field_name.replace("_", " ").title(),
                    ),
                    self._display_text(field_name, common_value),
                )
            )

        return rows

    def _common_specification_rows(
        self,
        assets: list[dict[str, Any]],
    ) -> list[tuple[str, str]]:
        if not assets:
            return []

        # Nur Spezifikationsfelder betrachten, die bei jedem Asset vorkommen.
        common_keys: set[str] | None = None
        for asset in assets:
            keys = {
                key
                for key in asset
                if is_specification_column(key)
            }
            common_keys = keys if common_keys is None else common_keys & keys

        if not common_keys:
            return []

        # Reihenfolge des ersten Assets beibehalten.
        ordered_keys = [
            key
            for key in assets[0]
            if key in common_keys
        ]

        rows: list[tuple[str, str]] = []

        for field_name in ordered_keys:
            common_value = self._common_nonempty_value(
                [asset.get(field_name) for asset in assets]
            )
            if common_value is None:
                continue

            label = self._common_specification_label(
                assets,
                field_name,
            )
            rows.append(
                (
                    label,
                    self._display_text(field_name, common_value),
                )
            )

        return rows

    @staticmethod
    def _common_specification_label(
        assets: list[dict[str, Any]],
        field_name: str,
    ) -> str:
        for asset in assets:
            labels = asset.get("_specification_labels")
            if isinstance(labels, dict):
                label = labels.get(field_name)
                if label is not None and str(label).strip():
                    return str(label).strip()

        return (
            field_name[len(SPECIFICATION_COLUMN_PREFIX):]
            .replace("_", " ")
            .title()
        )

    # ------------------------------------------------------------------
    # Vergleich / Formatierung
    # ------------------------------------------------------------------

    @classmethod
    def _common_nonempty_value(
        cls,
        values: list[Any],
    ) -> Any | None:
        if not values or any(cls._is_empty(value) for value in values):
            return None

        first = values[0]
        first_normalized = cls._normalize_for_comparison(first)

        if all(
            cls._normalize_for_comparison(value) == first_normalized
            for value in values[1:]
        ):
            return first

        return None

    @staticmethod
    def _normalize_for_comparison(value: Any) -> Any:
        if isinstance(value, str):
            return value.strip().casefold()

        if isinstance(value, (dict, list, tuple)):
            try:
                return json.dumps(
                    value,
                    ensure_ascii=False,
                    sort_keys=True,
                    default=str,
                )
            except TypeError:
                return str(value)

        return value

    @staticmethod
    def _is_empty(value: Any) -> bool:
        if value is None:
            return True
        if isinstance(value, str):
            return not value.strip()
        if isinstance(value, (list, tuple, dict, set)):
            return len(value) == 0
        return False

    @staticmethod
    def _is_placeholder_specification_value(value: Any) -> bool:
        """Erkennt alte Entwicklungs-Platzhalter wie "DEINE CPU"."""

        if not isinstance(value, str):
            return False

        text = value.strip()
        if not text or text != text.upper():
            return False

        normalized = text.casefold()
        return normalized.startswith(
            (
                "dein ",
                "deine ",
                "deinen ",
                "deinem ",
                "deiner ",
                "deines ",
            )
        )

    @staticmethod
    def _display_text(
        field_name: str,
        value: Any,
    ) -> str:
        return format_inventory_value(field_name, value)

    # ------------------------------------------------------------------
    # UI-Aufbau
    # ------------------------------------------------------------------

    def _clear_details(self) -> None:
        while self.details_layout.count():
            item = self.details_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()
            child_layout = item.layout()
            if child_layout is not None:
                self._clear_layout(child_layout)

        self.details_layout.addStretch()

    @classmethod
    def _clear_layout(cls, layout) -> None:
        while layout.count():
            item = layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()
            child_layout = item.layout()
            if child_layout is not None:
                cls._clear_layout(child_layout)

    def _add_section(
        self,
        title: str,
        rows: list[tuple[str, str]],
    ) -> None:
        container = QWidget()
        container.setObjectName("detailSection")
        layout = QVBoxLayout(container)
        layout.setContentsMargins(11, 10, 11, 11)
        layout.setSpacing(8)

        title_label = QLabel(title)
        title_label.setObjectName("detailSectionTitle")
        layout.addWidget(title_label)

        grid = QGridLayout()
        grid.setContentsMargins(0, 0, 0, 0)
        grid.setHorizontalSpacing(12)
        grid.setVerticalSpacing(6)
        grid.setColumnStretch(0, 0)
        grid.setColumnStretch(1, 1)
        grid.setColumnMinimumWidth(0, self.FIELD_LABEL_WIDTH)

        for row_index, (label_text, value_text) in enumerate(rows):
            label = QLabel(label_text)
            label.setObjectName("detailFieldName")
            label.setFixedWidth(self.FIELD_LABEL_WIDTH)
            label.setWordWrap(True)
            label.setAlignment(
                Qt.AlignmentFlag.AlignLeft
                | Qt.AlignmentFlag.AlignTop
            )

            value = QLabel(value_text)
            value.setObjectName("detailFieldValue")
            value.setWordWrap(True)
            value.setTextInteractionFlags(
                Qt.TextInteractionFlag.TextSelectableByMouse
            )
            value.setAlignment(
                Qt.AlignmentFlag.AlignLeft
                | Qt.AlignmentFlag.AlignTop
            )

            grid.addWidget(label, row_index, 0)
            grid.addWidget(value, row_index, 1)

        layout.addLayout(grid)

        # Vor dem Stretch einfügen.
        self.details_layout.insertWidget(
            max(0, self.details_layout.count() - 1),
            container,
        )

    def _add_info_section(
        self,
        title: str,
        text: str,
    ) -> None:
        container = QWidget()
        container.setObjectName("detailSection")
        layout = QVBoxLayout(container)
        layout.setContentsMargins(11, 10, 11, 11)
        layout.setSpacing(7)

        title_label = QLabel(title)
        title_label.setObjectName("detailSectionTitle")

        info = QLabel(text)
        info.setObjectName("detailInfoText")
        info.setWordWrap(True)

        layout.addWidget(title_label)
        layout.addWidget(info)

        self.details_layout.insertWidget(
            max(0, self.details_layout.count() - 1),
            container,
        )

    def _show_empty_message(self, text: str) -> None:
        label = QLabel(text)
        label.setWordWrap(True)
        self.details_layout.insertWidget(
            max(0, self.details_layout.count() - 1),
            label,
        )