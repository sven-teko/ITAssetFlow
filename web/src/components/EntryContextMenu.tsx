import { useEffect, useLayoutEffect, useRef } from "react";

type Props = { x: number; y: number; disabled: boolean; multiple?: boolean; onEdit: () => void; onMove?: () => void; onDuplicate?: () => void; onChangeStock?: () => void; onDelete: () => void; onClose: () => void };

export default function EntryContextMenu({ x, y, disabled, multiple, onEdit, onMove, onDuplicate, onChangeStock, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  }, [x, y, onDuplicate, onMove, onChangeStock]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: globalThis.PointerEvent) => { if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose(); };
    const close = () => onClose();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    const scrollOutside = (event: Event) => { if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose(); };
    window.addEventListener("scroll", scrollOutside, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", close); window.removeEventListener("scroll", scrollOutside, true); previous?.focus({ preventScroll: true }); };
  }, [onClose]);
  return <div ref={ref} className="entry-context-menu" role="menu" aria-label="Eintrag" style={{ left: x, top: y }}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); onClose(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const step = event.key === "ArrowUp" ? -1 : 1;
        buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + step + buttons.length) % buttons.length]?.focus();
      }
    }}>
    <button type="button" role="menuitem" aria-disabled={disabled} onClick={() => { if (!disabled) { onClose(); onEdit(); } }}>{multiple ? "Auswahl bearbeiten" : "Eintrag bearbeiten"}</button>
    {onDuplicate && <button type="button" role="menuitem" aria-disabled={disabled} onClick={() => { if (!disabled) { onClose(); onDuplicate(); } }}>Aus Produktmodell duplizieren</button>}
    {onMove && <button type="button" role="menuitem" aria-disabled={disabled} onClick={() => { if (!disabled) { onClose(); onMove(); } }}>Umlagern</button>}
    {onChangeStock && <button type="button" role="menuitem" aria-disabled={disabled} onClick={() => { if (!disabled) { onClose(); onChangeStock(); } }}>Lagerbestand ändern</button>}
    <button type="button" role="menuitem" aria-disabled={disabled} onClick={() => { if (!disabled) { onClose(); onDelete(); } }}>{multiple ? "Auswahl archivieren" : "Eintrag löschen"}</button>
  </div>;
}
