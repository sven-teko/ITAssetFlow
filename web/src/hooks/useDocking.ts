import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  PointerEvent as ReactPointerEvent,
  RefCallback,
} from "react";

import type { DockPosition } from "../components/MainMenu";
import type {
  DockDragState,
  DockDropTarget,
  DockPanelKind,
} from "../types/inventory";

type UseDockingOptions = {
  onStatus: (text: string) => void;
};

export default function useDocking({ onStatus }: UseDockingOptions) {
  const [navigationVisible, setNavigationVisible] = useState(true);
  const [detailVisible, setDetailVisible] = useState(true);
  const [navigationPosition, setNavigationPosition] = useState<DockPosition>("left");
  const [detailPosition, setDetailPosition] = useState<DockPosition>("right");
  const [dockOrder, setDockOrder] = useState<DockPanelKind[]>([
    "navigation",
    "detail",
  ]);
  const [dockDrag, setDockDrag] = useState<DockDragState | null>(null);

  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dockShellRefs = useRef<Record<DockPanelKind, HTMLDivElement | null>>({
    navigation: null,
    detail: null,
  });
  const dockPointerRef = useRef<{
    panel: DockPanelKind;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  const panelPosition = useCallback(
    (panel: DockPanelKind): DockPosition =>
      panel === "navigation" ? navigationPosition : detailPosition,
    [detailPosition, navigationPosition],
  );

  const setPanelPosition = useCallback(
    (panel: DockPanelKind, position: DockPosition): void => {
      if (panel === "navigation") {
        setNavigationPosition(position);
        setNavigationVisible(true);
      } else {
        setDetailPosition(position);
        setDetailVisible(true);
      }
    },
    [],
  );

  const insertBefore = useCallback(
    (panel: DockPanelKind, reference: DockPanelKind): void => {
      setDockOrder((current) => {
        const next = current.filter((item) => item !== panel);
        const index = next.indexOf(reference);

        if (index < 0) {
          return [panel, ...next];
        }

        next.splice(index, 0, panel);
        return next;
      });
    },
    [],
  );

  const insertAfter = useCallback(
    (panel: DockPanelKind, reference: DockPanelKind): void => {
      setDockOrder((current) => {
        const next = current.filter((item) => item !== panel);
        const index = next.indexOf(reference);

        if (index < 0) {
          return [...next, panel];
        }

        next.splice(index + 1, 0, panel);
        return next;
      });
    },
    [],
  );

  const applyDockTarget = useCallback(
    (panel: DockPanelKind, target: DockDropTarget): void => {
      if (target === "left-edge") {
        setPanelPosition(panel, "left");
        setDockOrder((current) => [
          panel,
          ...current.filter((item) => item !== panel),
        ]);
        onStatus(
          panel === "navigation"
            ? "Navigation ganz links angedockt."
            : "Detailansicht ganz links angedockt.",
        );
        return;
      }

      if (target === "right-edge") {
        setPanelPosition(panel, "right");
        setDockOrder((current) => [
          ...current.filter((item) => item !== panel),
          panel,
        ]);
        onStatus(
          panel === "navigation"
            ? "Navigation ganz rechts angedockt."
            : "Detailansicht ganz rechts angedockt.",
        );
        return;
      }

      const reference: DockPanelKind = target.endsWith("navigation")
        ? "navigation"
        : "detail";

      setPanelPosition(panel, panelPosition(reference));

      if (target.startsWith("before-")) {
        insertBefore(panel, reference);
        onStatus(
          panel === "navigation"
            ? "Navigation vor der Detailansicht angedockt."
            : "Detailansicht vor der Navigation angedockt.",
        );
      } else {
        insertAfter(panel, reference);
        onStatus(
          panel === "navigation"
            ? "Navigation hinter der Detailansicht angedockt."
            : "Detailansicht hinter der Navigation angedockt.",
        );
      }
    },
    [insertAfter, insertBefore, onStatus, panelPosition, setPanelPosition],
  );

  useEffect(() => {
    function dockTargetAt(
      clientX: number,
      clientY: number,
      draggedPanel: DockPanelKind,
    ): DockDropTarget | null {
      const workspace = workspaceRef.current;
      if (!workspace) {
        return null;
      }

      const otherPanel: DockPanelKind =
        draggedPanel === "navigation" ? "detail" : "navigation";
      const otherElement = dockShellRefs.current[otherPanel];

      if (otherElement) {
        const otherRect = otherElement.getBoundingClientRect();
        const overOther =
          clientX >= otherRect.left
          && clientX <= otherRect.right
          && clientY >= otherRect.top
          && clientY <= otherRect.bottom;

        if (overOther) {
          const before = clientX < otherRect.left + otherRect.width / 2;
          if (otherPanel === "navigation") {
            return before ? "before-navigation" : "after-navigation";
          }
          return before ? "before-detail" : "after-detail";
        }
      }

      const rect = workspace.getBoundingClientRect();
      const edgeZone = Math.min(190, Math.max(110, rect.width * 0.18));

      if (clientX >= rect.left && clientX <= rect.left + edgeZone) {
        return "left-edge";
      }

      if (clientX <= rect.right && clientX >= rect.right - edgeZone) {
        return "right-edge";
      }

      return null;
    }

    function pointerMove(event: PointerEvent): void {
      const pending = dockPointerRef.current;
      if (!pending) {
        return;
      }

      if (!pending.dragging) {
        const distance =
          Math.abs(event.clientX - pending.startX)
          + Math.abs(event.clientY - pending.startY);

        if (distance < 7) {
          return;
        }

        pending.dragging = true;
        document.body.classList.add("dock-panel-dragging");
      }

      event.preventDefault();
      setDockDrag({
        panel: pending.panel,
        target: dockTargetAt(event.clientX, event.clientY, pending.panel),
      });
    }

    function finishDockDrag(): void {
      const pending = dockPointerRef.current;
      if (!pending) {
        return;
      }

      dockPointerRef.current = null;
      document.body.classList.remove("dock-panel-dragging");

      setDockDrag((current) => {
        if (pending.dragging && current?.target) {
          applyDockTarget(pending.panel, current.target);
        }
        return null;
      });
    }

    window.addEventListener("pointermove", pointerMove, { passive: false });
    window.addEventListener("pointerup", finishDockDrag);
    window.addEventListener("pointercancel", finishDockDrag);
    window.addEventListener("blur", finishDockDrag);

    return () => {
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", finishDockDrag);
      window.removeEventListener("pointercancel", finishDockDrag);
      window.removeEventListener("blur", finishDockDrag);
      document.body.classList.remove("dock-panel-dragging");
    };
  }, [applyDockTarget]);

  const dockPanelAtEdge = useCallback(
    (panel: DockPanelKind, position: DockPosition): void => {
      setPanelPosition(panel, position);
      setDockOrder((current) => {
        const next = current.filter((item) => item !== panel);
        return position === "left" ? [panel, ...next] : [...next, panel];
      });
    },
    [setPanelPosition],
  );

  const beginDockPointer = useCallback(
    (panel: DockPanelKind, event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0 || !event.isPrimary) {
        return;
      }

      const target = event.target as HTMLElement;
      if (!target.closest(".dock-title")) {
        return;
      }

      event.preventDefault();
      dockPointerRef.current = {
        panel,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      };
    },
    [],
  );

  const panelRef = useCallback(
    (panel: DockPanelKind): RefCallback<HTMLDivElement> =>
      (element) => {
        dockShellRefs.current[panel] = element;
      },
    [],
  );

  const panelClassName = useCallback(
    (panel: DockPanelKind): string =>
      [
        "dock-shell",
        panel === "navigation" ? "dock-navigation-shell" : "dock-detail-shell",
        dockDrag?.panel === panel ? "dock-shell-dragging" : "",
        dockDrag?.target === `before-${panel}` ? "dock-shell-drop-before" : "",
        dockDrag?.target === `after-${panel}` ? "dock-shell-drop-after" : "",
      ]
        .filter(Boolean)
        .join(" "),
    [dockDrag],
  );

  return {
    navigationVisible,
    setNavigationVisible,
    detailVisible,
    setDetailVisible,
    navigationPosition,
    detailPosition,
    dockOrder,
    dockDrag,
    workspaceRef,
    panelPosition,
    dockPanelAtEdge,
    beginDockPointer,
    panelRef,
    panelClassName,
  };
}
