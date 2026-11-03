import { useEffect, useRef } from "react";

type Props = { x: number; y: number; disabled: boolean; multiple?: boolean; onEdit: () => void; onMove?: () => void; onChangeStock?: () => void; onDelete: () => void; onClose: () => void };

export default function EntryContextMenu({ x, y, disabled, multiple, onEdit, onMove, onChangeStock, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: globalThis.PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); previous?.focus({ preventScroll: true }); };
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
    {onMove && <button type="button" role="menuitem" aria-disabled={disabled} onClick={() => { if (!disabled) { onClose(); onMove(); } }}>Umlagern</button>}
    {onChangeStock && <button type="button" role="menuitem" aria-disabled={disabled} onClick={() => { if (!disabled) { onClose(); onChangeStock(); } }}>Lagerbestand ändern</button>}
    <button type="button" role="menuitem" aria-disabled={disabled} onClick={() => { if (!disabled) { onClose(); onDelete(); } }}>{multiple ? "Auswahl archivieren" : "Eintrag löschen"}</button>
  </div>;
}
