from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtCore import (
    QEasingCurve,
    QEvent,
    QObject,
    QPoint,
    QRect,
    QPropertyAnimation,
    Qt,
    QTimer,
    Signal,
    Slot,
)
from PySide6.QtGui import QCursor, QMouseEvent
from PySide6.QtWidgets import (
    QApplication,
    QDockWidget,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QStyle,
    QToolButton,
    QWidget,
)


class _DockTitleBar(QWidget):
    drag_started = Signal(object)
    drag_moved = Signal(object)
    drag_finished = Signal(object)
    float_requested = Signal()
    close_requested = Signal()

    def __init__(self, title: str, closable: bool, parent=None) -> None:
        super().__init__(parent)
        self._press: QPoint | None = None
        self._dragging = False
        self.setCursor(Qt.CursorShape.SizeAllCursor)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 3, 5, 3)
        layout.setSpacing(4)

        self._label = QLabel(title, self)
        self._label.setAttribute(
            Qt.WidgetAttribute.WA_TransparentForMouseEvents,
            True,
        )
        layout.addWidget(self._label)
        layout.addStretch()

        float_button = QToolButton(self)
        float_button.setAutoRaise(True)
        float_button.setToolTip("Lösen / wieder andocken")
        float_button.setIcon(
            self.style().standardIcon(
                QStyle.StandardPixmap.SP_TitleBarNormalButton
            )
        )
        float_button.clicked.connect(self.float_requested.emit)
        layout.addWidget(float_button)

        if closable:
            close_button = QToolButton(self)
            close_button.setAutoRaise(True)
            close_button.setToolTip("Schliessen")
            close_button.setIcon(
                self.style().standardIcon(
                    QStyle.StandardPixmap.SP_TitleBarCloseButton
                )
            )
            close_button.clicked.connect(self.close_requested.emit)
            layout.addWidget(close_button)

    def set_title(self, title: str) -> None:
        self._label.setText(title)

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._press = event.globalPosition().toPoint()
            self._dragging = False
        event.accept()

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if (
            self._press is None
            or not (event.buttons() & Qt.MouseButton.LeftButton)
        ):
            event.accept()
            return

        pos = event.globalPosition().toPoint()
        if not self._dragging:
            if (
                pos - self._press
            ).manhattanLength() < QApplication.startDragDistance():
                event.accept()
                return
            self._dragging = True
            self.drag_started.emit(pos)

        self.drag_moved.emit(pos)
        event.accept()

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton and self._dragging:
            self.drag_finished.emit(event.globalPosition().toPoint())
        self._press = None
        self._dragging = False
        event.accept()

    def mouseDoubleClickEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.float_requested.emit()
        event.accept()


@dataclass
class _State:
    width: int
    last_area: Qt.DockWidgetArea


@dataclass(frozen=True)
class _Target:
    area: Qt.DockWidgetArea
    side: str
    other: QDockWidget | None = None


class DockManager(QObject):
    """Zwei Sidebars, ausschliesslich horizontales Docking."""

    navigation_visibility_changed = Signal(bool)
    detail_visibility_changed = Signal(bool)
    navigation_floating_changed = Signal(bool)
    detail_floating_changed = Signal(bool)

    LEFT = Qt.DockWidgetArea.LeftDockWidgetArea
    RIGHT = Qt.DockWidgetArea.RightDockWidgetArea
    VALID_AREAS = (LEFT, RIGHT)
    BOTH_AREAS = LEFT | RIGHT
    NO_NATIVE_DOCK = Qt.DockWidgetArea.NoDockWidgetArea

    DEFAULT_NAVIGATION_WIDTH = 300
    DEFAULT_DETAIL_WIDTH = 380

    EDGE_ZONE = 110
    PREVIEW_MIN_WIDTH = 160
    PREVIEW_MS = 120
    RELEASE_POLL_MS = 25
    MAX_HEIGHT = 16777215

    def __init__(
        self,
        main_window: QMainWindow,
        navigation: QDockWidget,
        detail: QDockWidget,
        *,
        navigation_width: int = DEFAULT_NAVIGATION_WIDTH,
        detail_width: int = DEFAULT_DETAIL_WIDTH,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent or main_window)

        self.main_window = main_window
        self.navigation = navigation
        self.detail = detail
        self._states = {
            navigation: _State(
                max(navigation.minimumWidth(), navigation_width),
                self._area_or(navigation, self.LEFT),
            ),
            detail: _State(
                max(detail.minimumWidth(), detail_width),
                self._area_or(detail, self.RIGHT),
            ),
        }

        # Custom-Titelleisten werden nur im angedockten Zustand verwendet.
        # Floating verwendet bewusst die native Windows-Fensterdekoration.
        self._title_bars: dict[QDockWidget, _DockTitleBar] = {}

        self._dragging: QDockWidget | None = None
        self._drag_was_floating = False
        self._native_floating_drag = False
        self._drag_offset = QPoint()
        self._target: _Target | None = None
        self._layout_busy = False
        self._restoring = False

        self._preview = self._make_preview()
        self._proxy = self._make_proxy()

        self._preview_animation = QPropertyAnimation(
            self._preview,
            b"geometry",
            self,
        )
        self._preview_animation.setDuration(self.PREVIEW_MS)
        self._preview_animation.setEasingCurve(
            QEasingCurve.Type.OutCubic
        )

        self._release_timer = QTimer(self)
        self._release_timer.setInterval(self.RELEASE_POLL_MS)
        self._release_timer.timeout.connect(self._poll_release)

        self._width_timer = QTimer(self)
        self._width_timer.setSingleShot(True)
        self._width_timer.setInterval(180)
        self._width_timer.timeout.connect(self._capture_widths)

        self._configure_main_window()
        for dock in self._docks():
            self._configure_dock(dock)
            self._connect_dock(dock)

        self._schedule_restore()

    # ------------------------------------------------------------------
    # Öffentliche API
    # ------------------------------------------------------------------

    @Slot(bool)
    def set_navigation_visible(self, visible: bool) -> None:
        self._set_visible(self.navigation, visible)

    @Slot(bool)
    def set_detail_visible(self, visible: bool) -> None:
        self._set_visible(self.detail, visible)

    @Slot()
    def dock_navigation_left(self) -> None:
        self._dock_menu(self.navigation, self.LEFT)

    @Slot()
    def dock_navigation_right(self) -> None:
        self._dock_menu(self.navigation, self.RIGHT)

    @Slot()
    def dock_detail_left(self) -> None:
        self._dock_menu(self.detail, self.LEFT)

    @Slot()
    def dock_detail_right(self) -> None:
        self._dock_menu(self.detail, self.RIGHT)

    @Slot()
    def float_navigation(self) -> None:
        self._float(self.navigation)

    @Slot()
    def float_detail(self) -> None:
        self._float(self.detail)

    @Slot()
    def toggle_navigation_floating(self) -> None:
        self._toggle_floating(self.navigation)

    @Slot()
    def toggle_detail_floating(self) -> None:
        self._toggle_floating(self.detail)

    def restore_widths(self) -> None:
        if self._layout_busy or self._restoring:
            return

        self._restoring = True
        try:
            docked = [
                d for d in self._docks()
                if d.isVisible() and not d.isFloating()
            ]

            if len(docked) == 2 and self._area(docked[0]) == self._area(docked[1]):
                self.main_window.resizeDocks(
                    docked,
                    [self._states[d].width for d in docked],
                    Qt.Orientation.Horizontal,
                )
            else:
                for dock in docked:
                    self.main_window.resizeDocks(
                        [dock],
                        [self._states[dock].width],
                        Qt.Orientation.Horizontal,
                    )
        finally:
            self._restoring = False

    # ------------------------------------------------------------------
    # Einrichtung
    # ------------------------------------------------------------------

    def _configure_main_window(self) -> None:
        self.main_window.setDockNestingEnabled(True)
        self.main_window.setDockOptions(
            QMainWindow.DockOption.AnimatedDocks
            | QMainWindow.DockOption.AllowNestedDocks
        )
        self.main_window.setCorner(Qt.Corner.TopLeftCorner, self.LEFT)
        self.main_window.setCorner(Qt.Corner.BottomLeftCorner, self.LEFT)
        self.main_window.setCorner(Qt.Corner.TopRightCorner, self.RIGHT)
        self.main_window.setCorner(Qt.Corner.BottomRightCorner, self.RIGHT)

    def _configure_dock(self, dock: QDockWidget) -> None:
        features = dock.features()
        closable = bool(
            features
            & QDockWidget.DockWidgetFeature.DockWidgetClosable
        )

        # Kein nativer Drag => keine native Vorschau oben/unten.
        dock.setFeatures(
            features
            & ~QDockWidget.DockWidgetFeature.DockWidgetMovable
        )
        dock.setAllowedAreas(self.NO_NATIVE_DOCK)
        dock.installEventFilter(self)

        title_bar = _DockTitleBar(
            dock.windowTitle(),
            closable,
            dock,
        )
        dock.setTitleBarWidget(title_bar)
        self._title_bars[dock] = title_bar

        title_bar.drag_started.connect(
            lambda pos, d=dock: self._start_drag(d, pos)
        )
        title_bar.drag_moved.connect(
            lambda pos, d=dock: self._move_drag(d, pos)
        )
        title_bar.drag_finished.connect(
            lambda pos, d=dock: self._finish_drag(d, pos)
        )
        title_bar.float_requested.connect(
            lambda d=dock: self._toggle_floating(d)
        )
        title_bar.close_requested.connect(dock.close)
        dock.windowTitleChanged.connect(title_bar.set_title)

    def _connect_dock(self, dock: QDockWidget) -> None:
        dock.visibilityChanged.connect(
            lambda visible, d=dock: self._emit_visibility(d, visible)
        )
        dock.topLevelChanged.connect(
            lambda floating, d=dock: self._top_level_changed(d, floating)
        )
        dock.dockLocationChanged.connect(
            lambda area, d=dock: self._remember_area(d, area)
        )

    # ------------------------------------------------------------------
    # Menü-Docking
    # ------------------------------------------------------------------

    def _dock_menu(
        self,
        dock: QDockWidget,
        area: Qt.DockWidgetArea,
    ) -> None:
        """Baut die Dockposition ohne alte Qt-Split-Strukturen neu auf.

        Links:  Navigation | Detail | Tabelle
        Rechts: Tabelle | Detail | Navigation
        """

        self._validate_area(area)
        self._remember_width(dock)
        self._states[dock].last_area = area

        other = self._other(dock)
        other_docked = (
            other.isVisible()
            and not other.isFloating()
            and self._area(other) in self.VALID_AREAS
        )
        other_area = self._area(other) if other_docked else None
        visible = {d: d.isVisible() for d in self._docks()}

        self._layout_busy = True
        try:
            self.main_window.removeDockWidget(dock)
            if other_docked:
                self.main_window.removeDockWidget(other)

            if other_docked and other_area == area:
                first, second = self._pair_order(area)
                self._add_docked(first, area)
                self._add_docked(second, area)
                self.main_window.splitDockWidget(
                    first,
                    second,
                    Qt.Orientation.Horizontal,
                )
            else:
                self._add_docked(dock, area)
                if other_docked and other_area is not None:
                    self._add_docked(other, other_area)

            for current in self._docks():
                current.setVisible(visible[current])
                current.setAllowedAreas(self.NO_NATIVE_DOCK)
        finally:
            self._layout_busy = False

        if visible[dock]:
            dock.show()
            dock.raise_()

        self._schedule_restore()

    def _add_docked(
        self,
        dock: QDockWidget,
        area: Qt.DockWidgetArea,
    ) -> None:
        self._unlock_height(dock)
        dock.setAllowedAreas(self.BOTH_AREAS)

        # Beim Andocken wieder die eigene Titelleiste verwenden. Dadurch
        # bleibt der kontrollierte Horizontal-Drag aktiv.
        self._use_custom_title_bar(dock)

        self.main_window.addDockWidget(area, dock)
        if dock.isFloating():
            dock.setFloating(False)

        # Falls Qt den alten Floating-Zustand bevorzugt hat: erneut erzwingen.
        if dock.isFloating() or self._area(dock) != area:
            self.main_window.removeDockWidget(dock)
            self.main_window.addDockWidget(area, dock)
            dock.setFloating(False)

        self._states[dock].last_area = area

    def _pair_order(
        self,
        area: Qt.DockWidgetArea,
    ) -> tuple[QDockWidget, QDockWidget]:
        return (
            (self.navigation, self.detail)
            if area == self.LEFT
            else (self.detail, self.navigation)
        )

    # ------------------------------------------------------------------
    # Floating
    # ------------------------------------------------------------------

    def _float(
        self,
        dock: QDockWidget,
        top_left: QPoint | None = None,
    ) -> None:
        self._remember_width(dock)
        height = max(1, dock.height())

        dock.setAllowedAreas(self.NO_NATIVE_DOCK)

        # Wichtig: Die Custom-TitleBar muss VOR setFloating(True) entfernt
        # werden. So erzeugt Qt das neue Top-Level-Fenster direkt mit der
        # nativen Windows-Fensterdekoration.
        self._use_native_title_bar(dock)
        dock.setFloating(True)

        dock.resize(self._states[dock].width, height)

        # Floating-Fenster dürfen nur horizontal vergrössert/verkleinert
        # werden. Der native Windows-Rahmen bleibt sichtbar, die Höhe ist fix.
        dock.setMinimumHeight(height)
        dock.setMaximumHeight(height)

        if top_left is not None:
            dock.move(top_left)

        dock.setWindowOpacity(1.0)
        dock.show()
        dock.raise_()

    def _toggle_floating(self, dock: QDockWidget) -> None:
        if dock.isFloating():
            self._dock_menu(dock, self._states[dock].last_area)
        else:
            self._float(dock)

    def _set_visible(self, dock: QDockWidget, visible: bool) -> None:
        dock.setVisible(visible)
        if visible:
            dock.raise_()
            self._schedule_restore()

    # ------------------------------------------------------------------
    # Eigener Drag
    # ------------------------------------------------------------------

    def _start_drag(self, dock: QDockWidget, cursor: QPoint) -> None:
        if self._dragging is not None:
            return

        self._remember_width(dock)
        self._dragging = dock
        self._drag_was_floating = dock.isFloating()
        self._native_floating_drag = False
        self._target = None

        top_left = dock.mapToGlobal(QPoint(0, 0))
        self._drag_offset = cursor - top_left

        self._proxy.setGeometry(QRect(top_left, dock.size()))
        self._proxy.show()
        self._proxy.raise_()

        if self._drag_was_floating:
            dock.setWindowOpacity(0.15)

        self._release_timer.start()

    def _move_drag(self, dock: QDockWidget, cursor: QPoint) -> None:
        if self._dragging is not dock:
            return

        self._proxy.move(cursor - self._drag_offset)
        self._update_target(dock, cursor)

    @Slot()
    def _poll_release(self) -> None:
        if self._dragging is None:
            self._release_timer.stop()
            return

        if (
            QApplication.mouseButtons()
            & Qt.MouseButton.LeftButton
        ):
            return

        dock = self._dragging

        if self._native_floating_drag:
            self._finish_native_floating_drag(dock)
        else:
            self._finish_drag(
                dock,
                QCursor.pos(),
            )

    def _finish_drag(
        self,
        dock: QDockWidget,
        _cursor: QPoint,
    ) -> None:
        if self._dragging is not dock:
            return

        target = self._target
        was_floating = self._drag_was_floating
        final_pos = self._proxy.pos()

        self._dragging = None
        self._target = None
        self._native_floating_drag = False
        self._release_timer.stop()
        self._preview_animation.stop()
        self._preview.hide()
        self._proxy.hide()
        dock.setWindowOpacity(1.0)

        if target is not None:
            if target.other is None:
                self._dock_at_central_edge(dock, target.area)
            else:
                self._dock_beside(
                    dock,
                    target.other,
                    target.side,
                )
            return

        if was_floating:
            dock.move(final_pos)
            dock.show()
            dock.raise_()
        else:
            self._float(dock, final_pos)

    # ------------------------------------------------------------------
    # Drag-Docking
    # ------------------------------------------------------------------

    def _dock_beside(
        self,
        dock: QDockWidget,
        other: QDockWidget,
        side: str,
    ) -> None:
        area = self._area(other)
        if area not in self.VALID_AREAS:
            return

        visible = {
            dock: dock.isVisible(),
            other: other.isVisible(),
        }
        first, second = (
            (dock, other)
            if side == "left"
            else (other, dock)
        )

        self._layout_busy = True
        try:
            self.main_window.removeDockWidget(dock)
            self.main_window.removeDockWidget(other)

            self._add_docked(first, area)
            self._add_docked(second, area)
            self.main_window.splitDockWidget(
                first,
                second,
                Qt.Orientation.Horizontal,
            )

            for current in (dock, other):
                current.setVisible(visible[current])
                current.setAllowedAreas(self.NO_NATIVE_DOCK)
        finally:
            self._layout_busy = False

        self._schedule_restore()

    def _dock_at_central_edge(
        self,
        dock: QDockWidget,
        area: Qt.DockWidgetArea,
    ) -> None:
        other = self._other(dock)

        if (
            other.isVisible()
            and not other.isFloating()
            and self._area(other) == area
        ):
            self._dock_beside(
                dock,
                other,
                "right" if area == self.LEFT else "left",
            )
        else:
            self._dock_menu(dock, area)

    # ------------------------------------------------------------------
    # Drop-Ziele / Vorschau
    # ------------------------------------------------------------------

    def _update_target(self, dock: QDockWidget, cursor: QPoint) -> None:
        target = self._target_other(dock, cursor) or self._target_central(cursor)
        self._target = target

        if target is None:
            self._preview_animation.stop()
            self._preview.hide()
            return

        rect = self._preview_rect(dock, target)
        if rect is not None:
            self._animate_preview(rect, target.side)

    def _target_other(
        self,
        dock: QDockWidget,
        cursor: QPoint,
    ) -> _Target | None:
        other = self._other(dock)

        if not other.isVisible() or other.isFloating():
            return None

        area = self._area(other)
        if area not in self.VALID_AREAS:
            return None

        rect = self._global_rect(other)
        if not (rect.top() <= cursor.y() <= rect.bottom()):
            return None

        left = QRect(
            rect.left() - self.EDGE_ZONE,
            rect.top(),
            self.EDGE_ZONE * 2,
            rect.height(),
        )
        right = QRect(
            rect.right() - self.EDGE_ZONE + 1,
            rect.top(),
            self.EDGE_ZONE * 2,
            rect.height(),
        )

        if left.contains(cursor):
            return _Target(area, "left", other)
        if right.contains(cursor):
            return _Target(area, "right", other)
        return None

    def _target_central(self, cursor: QPoint) -> _Target | None:
        central = self.main_window.centralWidget()
        if central is None:
            return None

        rect = self._global_rect(central)
        if not (rect.top() <= cursor.y() <= rect.bottom()):
            return None

        if rect.left() <= cursor.x() <= rect.left() + self.EDGE_ZONE:
            return _Target(self.LEFT, "left")

        if rect.right() - self.EDGE_ZONE <= cursor.x() <= rect.right():
            return _Target(self.RIGHT, "right")

        return None

    def _preview_rect(
        self,
        dock: QDockWidget,
        target: _Target,
    ) -> QRect | None:
        width = max(
            self.PREVIEW_MIN_WIDTH,
            self._states[dock].width,
        )

        if target.other is not None:
            rect = self._rect_in_main(target.other)
            width = min(
                width,
                max(
                    self.PREVIEW_MIN_WIDTH,
                    self.main_window.width() // 2,
                ),
            )

            if target.side == "left":
                x = max(0, rect.left() - width)
                if x == rect.left():
                    x = rect.left()
            else:
                x = rect.right() + 1
                if x + width > self.main_window.width():
                    x = rect.right() - width + 1

            return QRect(x, rect.top(), width, rect.height())

        central = self.main_window.centralWidget()
        if central is None:
            return None

        rect = self._rect_in_main(central)
        width = min(
            width,
            max(self.PREVIEW_MIN_WIDTH, rect.width() - 40),
        )
        x = (
            rect.left()
            if target.area == self.LEFT
            else rect.right() - width + 1
        )
        return QRect(x, rect.top(), width, rect.height())

    def _animate_preview(self, target: QRect, side: str) -> None:
        if self._preview.isVisible() and self._preview.geometry() == target:
            return

        self._preview_animation.stop()

        if self._preview.isVisible():
            start = self._preview.geometry()
        else:
            collapsed = min(22, target.width())
            x = (
                target.left()
                if side == "left"
                else target.right() - collapsed + 1
            )
            start = QRect(
                x,
                target.top(),
                collapsed,
                target.height(),
            )
            self._preview.setGeometry(start)
            self._preview.show()
            self._preview.raise_()

        self._preview_animation.setStartValue(start)
        self._preview_animation.setEndValue(target)
        self._preview_animation.start()

    # ------------------------------------------------------------------
    # Breiten / Signale / Hilfen
    # ------------------------------------------------------------------

    def eventFilter(self, watched: QObject, event: QEvent) -> bool:
        if watched not in self._docks():
            return super().eventFilter(watched, event)

        event_type = event.type()
        dock = watched

        # Floating besitzt jetzt einen echten nativen Windows-Rahmen. Dessen
        # Verschieben läuft nicht über _DockTitleBar. Wir beobachten deshalb
        # die nativen Fensterbewegungen und verwenden weiterhin unsere eigenen
        # linken/rechten Drop-Ziele.
        if dock.isFloating():
            if event_type == QEvent.Type.NonClientAreaMouseButtonPress:
                if (
                    QApplication.mouseButtons()
                    & Qt.MouseButton.LeftButton
                ):
                    self._begin_native_floating_drag(dock)

            elif event_type == QEvent.Type.Move:
                if (
                    QApplication.mouseButtons()
                    & Qt.MouseButton.LeftButton
                ):
                    if self._dragging is None:
                        self._begin_native_floating_drag(dock)

                    if (
                        self._dragging is dock
                        and self._native_floating_drag
                    ):
                        self._update_target(
                            dock,
                            QCursor.pos(),
                        )

            elif event_type == QEvent.Type.NonClientAreaMouseButtonRelease:
                if (
                    self._dragging is dock
                    and self._native_floating_drag
                ):
                    self._finish_native_floating_drag(dock)

        if (
            event_type == QEvent.Type.Resize
            and not self._layout_busy
            and self._dragging is None
        ):
            self._width_timer.start()

        return super().eventFilter(watched, event)

    def _begin_native_floating_drag(
        self,
        dock: QDockWidget,
    ) -> None:
        if self._dragging is not None:
            return

        self._remember_width(dock)
        self._dragging = dock
        self._drag_was_floating = True
        self._native_floating_drag = True
        self._target = None
        self._preview.hide()
        self._release_timer.start()

    def _finish_native_floating_drag(
        self,
        dock: QDockWidget,
    ) -> None:
        if (
            self._dragging is not dock
            or not self._native_floating_drag
        ):
            return

        target = self._target

        self._dragging = None
        self._target = None
        self._native_floating_drag = False
        self._release_timer.stop()
        self._preview_animation.stop()
        self._preview.hide()

        if target is None:
            dock.show()
            dock.raise_()
            return

        if target.other is None:
            self._dock_at_central_edge(
                dock,
                target.area,
            )
        else:
            self._dock_beside(
                dock,
                target.other,
                target.side,
            )

    def _capture_widths(self) -> None:
        if self._layout_busy or self._dragging is not None:
            return

        for dock in self._docks():
            if dock.isVisible():
                self._remember_width(dock)

    def _remember_width(self, dock: QDockWidget) -> None:
        width = dock.width()
        if width >= dock.minimumWidth():
            self._states[dock].width = width

    def _schedule_restore(self) -> None:
        for delay in (0, 60, 140):
            QTimer.singleShot(delay, self.restore_widths)

    def _top_level_changed(
        self,
        dock: QDockWidget,
        floating: bool,
    ) -> None:
        self._emit_floating(dock, floating)

        # Während eines programmgesteuerten Layoutwechsels Areas nicht
        # vorzeitig sperren.
        if not self._layout_busy:
            dock.setAllowedAreas(self.NO_NATIVE_DOCK)

        if floating:
            self._use_native_title_bar(dock)
        else:
            self._unlock_height(dock)
            self._use_custom_title_bar(dock)

    def _remember_area(
        self,
        dock: QDockWidget,
        area: Qt.DockWidgetArea,
    ) -> None:
        if area in self.VALID_AREAS:
            self._states[dock].last_area = area

    def _use_native_title_bar(
        self,
        dock: QDockWidget,
    ) -> None:
        """Floating: echte native Windows-Fensterdekoration verwenden."""

        if dock.titleBarWidget() is not None:
            dock.setTitleBarWidget(None)

    def _use_custom_title_bar(
        self,
        dock: QDockWidget,
    ) -> None:
        """Angedockt: eigene Titelleiste für horizontal-only Drag verwenden."""

        title_bar = self._title_bars.get(dock)
        if (
            title_bar is not None
            and dock.titleBarWidget() is not title_bar
        ):
            dock.setTitleBarWidget(title_bar)

    def _unlock_height(self, dock: QDockWidget) -> None:
        dock.setMinimumHeight(0)
        dock.setMaximumHeight(self.MAX_HEIGHT)

    def _emit_visibility(
        self,
        dock: QDockWidget,
        visible: bool,
    ) -> None:
        (
            self.navigation_visibility_changed
            if dock is self.navigation
            else self.detail_visibility_changed
        ).emit(visible)

    def _emit_floating(
        self,
        dock: QDockWidget,
        floating: bool,
    ) -> None:
        (
            self.navigation_floating_changed
            if dock is self.navigation
            else self.detail_floating_changed
        ).emit(floating)

    def _other(self, dock: QDockWidget) -> QDockWidget:
        return self.detail if dock is self.navigation else self.navigation

    def _docks(self) -> tuple[QDockWidget, QDockWidget]:
        return self.navigation, self.detail

    def _area(self, dock: QDockWidget) -> Qt.DockWidgetArea:
        return self.main_window.dockWidgetArea(dock)

    def _area_or(
        self,
        dock: QDockWidget,
        fallback: Qt.DockWidgetArea,
    ) -> Qt.DockWidgetArea:
        area = self._area(dock)
        return area if area in self.VALID_AREAS else fallback

    @staticmethod
    def _global_rect(widget: QWidget) -> QRect:
        return QRect(
            widget.mapToGlobal(QPoint(0, 0)),
            widget.size(),
        )

    def _rect_in_main(self, widget: QWidget) -> QRect:
        return QRect(
            self.main_window.mapFromGlobal(
                widget.mapToGlobal(QPoint(0, 0))
            ),
            widget.size(),
        )

    def _make_preview(self) -> QFrame:
        frame = QFrame(self.main_window)
        frame.setAttribute(
            Qt.WidgetAttribute.WA_TransparentForMouseEvents,
            True,
        )
        frame.setStyleSheet("""
            QFrame {
                background-color: rgba(61, 145, 230, 50);
                border: 2px solid rgb(61, 145, 230);
                border-radius: 3px;
            }
        """)
        frame.hide()
        return frame

    @staticmethod
    def _make_proxy() -> QFrame:
        frame = QFrame(
            None,
            Qt.WindowType.Tool
            | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint,
        )
        frame.setAttribute(
            Qt.WidgetAttribute.WA_ShowWithoutActivating,
            True,
        )
        frame.setAttribute(
            Qt.WidgetAttribute.WA_TransparentForMouseEvents,
            True,
        )
        frame.setWindowOpacity(0.82)
        frame.setStyleSheet("""
            QFrame {
                background-color: rgb(245, 247, 249);
                border: 1px solid rgb(139, 150, 163);
                border-radius: 3px;
            }
        """)
        frame.hide()
        return frame

    @classmethod
    def _validate_area(cls, area: Qt.DockWidgetArea) -> None:
        if area not in cls.VALID_AREAS:
            raise ValueError(
                "Sidebars dürfen nur links oder rechts angedockt werden."
            )