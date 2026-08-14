from __future__ import annotations

from PySide6.QtWidgets import QApplication, QWidget

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
                background-color: #f3f4f6;
                color: #111827;
                padding: 7px;
                border-bottom: 1px solid #d8dde3;
            }

            QDockWidget > QWidget {
                background-color: #ffffff;
                color: #111827;
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
                font-size: 14px;
                font-weight: 600;
                margin-top: 3px;
            }

            QLabel#selectionLabel {
                background-color: #f5f7f9;
                border: 1px solid #d8dde3;
                border-radius: 6px;
                padding: 10px;
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

            /* Unter Windows-Dark-Mode übernimmt der Viewport eines
               QScrollArea sonst teilweise die dunkle Systempalette. */
            QScrollArea#categoryScrollArea,
            QWidget#categoryScrollViewport,
            QWidget#categoryContainer {
                background-color: #ffffff;
                color: #111827;
                border: none;
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

            /* Auch der leere Bereich rechts neben der letzten
               Tabellenüberschrift erhält eine helle Farbe. */
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

            /* Explizite Scrollbar-Farben verhindern unleserliche
               Steuerelemente bei aktivem Windows-Dark-Mode. */
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


def apply_light_theme(widget: QWidget) -> None:
    """Wendet das helle Design auf die gesamte Qt-Anwendung an.

    Dadurch übernehmen auch modale Dialoge wie QMessageBox nicht mehr die
    dunkle Windows-Palette, wenn Windows im Dark Mode läuft.
    """

    app = QApplication.instance()
    if app is not None:
        app.setStyleSheet(LIGHT_STYLESHEET)
    else:
        widget.setStyleSheet(LIGHT_STYLESHEET)