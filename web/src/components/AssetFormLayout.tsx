import type { FormEventHandler, ReactNode } from "react";
import "../pages/AssetFormPage.css";

type Props = {
  title: string;
  description: string;
  saving: boolean;
  saveDisabled?: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
};

export default function AssetFormLayout({ title, description, saving, saveDisabled, submitLabel, onCancel, onSubmit, children }: Props) {
  return <div className="asset-form-page asset-form-page--editor">
    <form className="asset-form-shell" onSubmit={onSubmit}>
      <div className="asset-form-scroll">
        <header className="asset-form-header">
          <div><h1>{title}</h1><p>{description}</p></div>
          <button type="button" className="asset-form-back-button" disabled={saving} onClick={onCancel}>← Zurück zum Inventar</button>
        </header>
        {children}
      </div>
      <footer className="asset-form-actions">
        <button type="button" disabled={saving} onClick={onCancel}>Abbrechen</button>
        <button type="submit" className="primary-button" disabled={saving || saveDisabled}>
          {saving ? "Wird gespeichert ..." : submitLabel}
        </button>
      </footer>
    </form>
  </div>;
}
