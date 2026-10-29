import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import "./SiteAccessDropdown.css";

type SiteOption = { key: string; label: string };

type SiteAccessDropdownProps = {
  name: string;
  options: SiteOption[];
  selected: string[];
  locked: boolean;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (selected: string[]) => void;
};

export default function SiteAccessDropdown({
  name, options, selected, locked, disabled, open, onOpenChange, onChange,
}: SiteAccessDropdownProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ left: number; top: number } | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const selectedKeys = new Set(selected);
  const selectedOptions = options.filter(option => selectedKeys.has(option.key));
  const summary = options.length === 0 ? "Keine Standorte vorhanden"
    : locked || selectedOptions.length === options.length ? "Alle Standorte"
    : selectedOptions.length === 0 ? "Kein Standort freigegeben"
    : selectedOptions.length === 1 ? selectedOptions[0].label
    : `${selectedOptions.length} von ${options.length} Standorten`;

  function openPopup(): void {
    const button = buttonRef.current;
    if (!button || disabled || locked || options.length === 0) return;
    const rect = button.getBoundingClientRect();
    anchorRef.current = { left: rect.left, top: rect.top };
    const gap = 6;
    const padding = 12;
    const width = Math.min(340, window.innerWidth - padding * 2);
    const below = window.innerHeight - rect.bottom - gap - padding;
    const above = rect.top - gap - padding;
    const upwards = below < 280 && above > below;
    setPosition({
      left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)),
      width,
      maxHeight: Math.min(400, Math.max(120, upwards ? above : below)),
      ...(upwards ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    });
    onOpenChange(true);
  }

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== buttonRef.current) return;
      popupRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: Event): void {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) {
        onOpenChange(false);
      }
    }
    function closeWithEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      buttonRef.current?.focus({ preventScroll: true });
    }
    function closeOnScroll(event: Event): void {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      const rect = buttonRef.current?.getBoundingClientRect();
      const anchor = anchorRef.current;
      if (!rect || !anchor || Math.abs(rect.left - anchor.left) > 1 || Math.abs(rect.top - anchor.top) > 1) onOpenChange(false);
    }
    function closeOnResize(): void { onOpenChange(false); }
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open, onOpenChange]);

  return (
    <div className="site-access-dropdown">
      <button
        ref={buttonRef}
        type="button"
        className={`site-access-trigger${locked ? " site-access-locked" : ""}`}
        aria-label={`Standorte für ${name} auswählen`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled || locked || options.length === 0}
        title={locked ? "Administratoren haben Zugriff auf alle Standorte." : selectedOptions.map(option => option.label).join(", ") || summary}
        onClick={() => open ? onOpenChange(false) : openPopup()}
        onKeyDown={event => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openPopup();
          }
        }}
      >
        <span>{summary}</span>
        {locked ? <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="9" width="10" height="8" rx="2" /><path d="M7 9V6a3 3 0 0 1 6 0v3" /></svg>
          : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>}
      </button>
      {open && !disabled && !locked && createPortal(
        <div
          id={id}
          ref={popupRef}
          className="site-access-popup"
          style={position}
          role="dialog"
          aria-label={`Standortauswahl für ${name}`}
        >
          <div className="site-access-heading">
            <strong>Standorte freigeben</strong>
            <span>{selectedOptions.length} von {options.length}</span>
          </div>
          <div className="site-access-actions">
            <button type="button" onClick={() => onChange(options.map(option => option.key))}>Alle auswählen</button>
            <button type="button" onClick={() => onChange([])}>Auswahl aufheben</button>
          </div>
          <fieldset className="site-access-options" aria-label={`Standorte für ${name}`}>
            {options.map(option => <label key={option.key}>
              <input
                type="checkbox"
                checked={selectedKeys.has(option.key)}
                onChange={event => onChange(options.filter(site => site.key === option.key ? event.target.checked : selectedKeys.has(site.key)).map(site => site.key))}
              />
              <span>{option.label}</span>
            </label>)}
          </fieldset>
        </div>,
        document.body,
      )}
    </div>
  );
}
