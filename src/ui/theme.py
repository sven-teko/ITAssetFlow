from __future__ import annotations

from PySide6.QtWidgets import QApplication


LIGHT_STYLESHEET = r"""
QMainWindow {
    background-color: #f4f6f8;
}

QMenuBar {
    background-color: #ffffff;
    color: #111827;
    border-bottom: 1px solid #d8dde3;
    padding: 3px;
}

QMenuBar::item {
    background: transparent;
    color: #111827;
    padding: 7px 11px;
}

QMenuBar::item:selected,
QMenuBar::item:pressed {
    background-color: #e9eef4;
    color: #111827;
    border-radius: 4px;
}

QMenu {
    background-color: #ffffff;
    color: #111827;
    border: 1px solid #d8dde3;
    padding: 4px;
}

QMenu::item {
    color: #111827;
    padding: 7px 30px 7px 12px;
}

QMenu::item:selected {
    background-color: #e9eef4;
    color: #111827;
}

QDockWidget {
    color: #111827;
    font-weight: 600;
}

QDockWidget::title {
    background-color: #e7eaee;
    color: #111827;
    padding: 8px 10px;
    border-bottom: 1px solid #d5d9df;
}

QDockWidget#navigationSidebar,
QDockWidget#assetDetailSidebar {
    background-color: #f1f3f5;
    color: #1f2937;
    font-size: 10.5pt;
}

QWidget#navigationContent,
QWidget#detailRoot,
QWidget#detailDetailsWidget,
QScrollArea#detailScrollArea,
QScrollArea#detailScrollArea > QWidget > QWidget {
    background-color: #f1f3f5;
    color: #1f2937;
}

QLabel {
    color: #111827;
}

QLabel#pageTitle {
    font-size: 23px;
    font-weight: 600;
}

QLabel#recordCountLabel,
QLabel#sidebarCountLabel {
    color: #66717c;
}

QLabel#sidebarTitle {
    color: #111827;
    font-size: 10.5pt;
    font-weight: 600;
    margin-top: 3px;
}

QLabel#selectionLabel {
    background-color: #ffffff;
    color: #374151;
    border: 1px solid #d8dde5;
    border-radius: 6px;
    padding: 8px 9px;
}

QDockWidget#navigationSidebar QLabel {
    background-color: transparent;
    color: #374151;
    font-size: 10.5pt;
}

QDockWidget#navigationSidebar QLabel#sidebarTitle {
    color: #111827;
    font-weight: 600;
}

QDockWidget#navigationSidebar QLabel#sidebarCountLabel {
    color: #6b7280;
    padding-top: 2px;
}

QGroupBox {
    background-color: #ffffff;
    color: #111827;
    font-weight: 600;
    border: 1px solid #d8dde3;
    border-radius: 6px;
    margin-top: 8px;
    padding-top: 8px;
}

QGroupBox::title {
    subcontrol-origin: margin;
    left: 8px;
    padding: 0 4px;
}

QCheckBox {
    background-color: transparent;
    color: #111827;
    spacing: 7px;
    font-weight: 400;
}

QCheckBox#filterOption {
    border-radius: 5px;
    padding: 7px 10px;
}

QCheckBox#filterOption:hover {
    background-color: #e8eef5;
    color: #111827;
}

QCheckBox#filterOption:checked {
    background-color: #f3f6fa;
}

QCheckBox#filterOption:checked:hover {
    background-color: #e3ebf4;
}

QLineEdit {
    min-height: 34px;
    padding-left: 9px;
    padding-right: 9px;
    background-color: #ffffff;
    color: #111827;
    border: 1px solid #c9d1d9;
    border-radius: 5px;
}

QLineEdit:focus {
    border: 1px solid #2f6fb7;
}

QPushButton {
    min-height: 35px;
    padding: 0 11px;
    text-align: left;
    background-color: #ffffff;
    color: #111827;
    border: 1px solid #c9d1d9;
    border-radius: 5px;
}

QPushButton:hover {
    background-color: #edf2f6;
}

QPushButton:disabled {
    color: #9ba4ad;
    background-color: #f4f6f8;
}

QPushButton#primaryButton {
    background-color: #2868ad;
    border-color: #2868ad;
    color: #ffffff;
    font-weight: 600;
}

QPushButton#primaryButton:hover {
    background-color: #215b98;
}

QWidget#detailSection {
    background-color: #ffffff;
    border: 1px solid #dde2e8;
    border-radius: 7px;
}

QDockWidget#assetDetailSidebar QLabel {
    background-color: transparent;
    color: #374151;
    font-size: 10.5pt;
}

QLabel#detailSelectionTitle {
    color: #111827;
    font-size: 12pt;
    font-weight: 700;
}

QLabel#detailSelectionHint,
QLabel#detailInfoText {
    color: #5b6470;
    font-size: 10.5pt;
}

QLabel#detailSectionTitle {
    color: #111827;
    font-size: 10.5pt;
    font-weight: 700;
}

QLabel#detailFieldName {
    color: #5b6470;
    font-size: 10.5pt;
}

QLabel#detailFieldValue {
    color: #111827;
    font-size: 10.5pt;
    font-weight: 500;
}

QFrame#detailSeparator {
    color: #cfd5dd;
    background-color: #cfd5dd;
    max-height: 1px;
}

QTableWidget {
    background-color: #ffffff;
    alternate-background-color: #f8fafb;
    color: #111827;
    border: 1px solid #d8dde3;
    border-radius: 6px;
    outline: 0;
    selection-background-color: #cfe4ff;
    selection-color: #111827;
}

QTableWidget::item {
    padding: 7px;
    border: none;
    border-bottom: 1px solid #edf0f2;
}

QTableWidget::item:selected {
    background-color: #cfe4ff;
    color: #111827;
    border: none;
    outline: none;
}

QTableWidget::item:focus {
    border: none;
    outline: none;
}

QHeaderView {
    background-color: #edf1f5;
    color: #111827;
}

QHeaderView::section {
    background-color: #edf1f5;
    color: #111827;
    border: none;
    border-right: 1px solid #d8dde3;
    border-bottom: 1px solid #d8dde3;
    padding: 8px;
    font-weight: 600;
}

QTableCornerButton::section {
    background-color: #edf1f5;
    border: none;
    border-right: 1px solid #d8dde3;
    border-bottom: 1px solid #d8dde3;
}

QScrollBar:horizontal {
    background-color: #e5e7eb;
    height: 16px;
    margin: 0;
    border: 1px solid #cbd5e1;
}

QScrollBar::handle:horizontal {
    background-color: #8b96a3;
    min-width: 36px;
    margin: 2px;
    border-radius: 5px;
}

QScrollBar::handle:horizontal:hover {
    background-color: #647181;
}

QScrollBar:vertical {
    background-color: #e5e7eb;
    width: 16px;
    margin: 0;
    border: 1px solid #cbd5e1;
}

QScrollBar::handle:vertical {
    background-color: #8b96a3;
    min-height: 36px;
    margin: 2px;
    border-radius: 5px;
}

QScrollBar::handle:vertical:hover {
    background-color: #647181;
}

QScrollBar::add-line,
QScrollBar::sub-line {
    width: 0;
    height: 0;
    background: none;
    border: none;
}

QScrollBar::add-page,
QScrollBar::sub-page {
    background: transparent;
}

QDockWidget#assetDetailSidebar QScrollBar:vertical {
    width: 12px;
}

QDockWidget#assetDetailSidebar QScrollBar:horizontal {
    height: 12px;
}

QDialog,
QMessageBox {
    background-color: #f4f6f8;
    color: #111827;
}

QMessageBox QLabel {
    background-color: transparent;
    color: #111827;
}

QMessageBox QPushButton {
    min-width: 84px;
    min-height: 32px;
    padding: 0 12px;
    background-color: #ffffff;
    color: #111827;
    border: 1px solid #c9d1d9;
    border-radius: 5px;
    text-align: center;
}

QMessageBox QPushButton:hover {
    background-color: #edf2f6;
}

QToolTip {
    background-color: #ffffff;
    color: #111827;
    border: 1px solid #9ca3af;
    padding: 4px;
}

QStatusBar {
    background-color: #ffffff;
    color: #5c6670;
    border-top: 1px solid #d8dde3;
}

QLabel#userStatusLabel {
    padding-left: 12px;
    padding-right: 8px;
    color: #5c6670;
}
"""


def apply_light_theme(app: QApplication) -> None:
    """Wendet das zentrale helle Design auf die gesamte Anwendung an."""

    app.setStyleSheet(LIGHT_STYLESHEET)
