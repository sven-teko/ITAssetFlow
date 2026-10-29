import { useCallback, useEffect, useRef, useState, type PointerEvent, type MouseEvent } from "react";
import type { InventoryRow } from "../types/inventory";

export default function useRowContextMenu(onSelect: (row: InventoryRow) => void) {
  const [menu, setMenu] = useState<{ row: InventoryRow; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const consumed = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clear, []);
  function open(row: InventoryRow, x: number, y: number) {
    onSelect(row);
    setMenu({ row, x: Math.max(8, Math.min(x, innerWidth - 232)), y: Math.max(8, Math.min(y, innerHeight - 120)) });
  }
  const close = useCallback(() => setMenu(null), []);
  return {
    menu, close,
    bind: (row: InventoryRow) => ({
      onContextMenu: (event: MouseEvent) => { event.preventDefault(); clear(); consumed.current = true; open(row, event.clientX, event.clientY); },
      onPointerDown: (event: PointerEvent) => {
        clear(); consumed.current = false;
        if (event.pointerType === "mouse" || event.isPrimary === false) return;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => { consumed.current = true; open(row, event.clientX, event.clientY); }, 550);
      },
      onPointerMove: (event: PointerEvent) => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) clear(); },
      onPointerUp: clear,
      onPointerCancel: clear,
      onClickCapture: (event: MouseEvent) => { if (consumed.current) { event.preventDefault(); event.stopPropagation(); consumed.current = false; } },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); open(row, bounds.left + 20, bounds.top + 20);
        }
      },
    }),
  };
}
