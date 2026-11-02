import { useEffect } from "react";
import { APP_VERSION, RELEASE_DATE } from "../release";

type AboutDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function closeWithEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="about-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
      >
        <button
          type="button"
          className="about-close-button"
          aria-label="Über-Fenster schliessen"
          title="Schliessen"
          onClick={onClose}
        >
          ×
        </button>

        <div className="about-logo-wrap">
          <img
            className="about-logo"
            src="/logo.png"
            alt="ITAssetFlow"
            draggable={false}
          />
        </div>

        <div className="about-dialog-content">
          <h2 id="about-dialog-title">ITAssetFlow</h2>
          <p>Version {APP_VERSION} · {RELEASE_DATE}</p>
          <p>IT-Inventarverwaltung für Geräte, Mengenartikel und Standorte.</p>
          <p className="about-company">DLC-Informatik GmbH</p>
        </div>

        <div className="about-dialog-actions">
          <button
            type="button"
            className="primary-button"
            autoFocus
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
