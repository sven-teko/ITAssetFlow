import { useEffect, useRef, useState, type FormEvent } from "react";
import { adjustQrStock, lookupQr, QrRequestError, type QrLookup, type QrMatch } from "../api/qrApi";
import { deleteInventoryEntries } from "../api/inventoryApi";
import QrScanner from "./QrScanner";
import "./QrWorkflowDialog.css";

type Props = {
  canEdit: boolean;
  onClose: () => void;
  onCreate: (code: string) => void;
  onEdit: (key: string) => void;
  onChanged: () => Promise<void>;
};

const CONDITIONS: Record<string, string> = { new: "Neu", like_new: "Neuwertig", used: "Gebraucht", worn: "Abgenutzt", defective: "Defekt" };

export default function QrWorkflowDialog({ canEdit, onClose, onCreate, onEdit, onChanged }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<QrLookup | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [locationId, setLocationId] = useState("");
  const [condition, setCondition] = useState("used");
  const [quantity, setQuantity] = useState("1");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { requestRef.current?.abort(); dialog?.close(); };
  }, []);

  const selected = lookup?.matches.find((row) => row.key === selectedKey) ?? lookup?.matches[0];
  const balance = lookup?.matches.find((row) => row.record_type === "stock"
    && row.product_model_id === selected?.product_model_id
    && String(row.storage_location_id) === locationId && row.condition === condition)?.quantity ?? 0;

  function selectMatch(row: QrMatch) {
    setSelectedKey(row.key);
    setLocationId(String(row.storage_location_id ?? lookup?.locations[0]?.id ?? ""));
    setCondition(row.condition || "used");
    setQuantity("1");
    setMessage("");
  }

  async function readCode(value: string, preserve = false) {
    if (busyRef.current) return;
    const normalized = value.trim();
    if (!normalized || normalized.length > 100 || Array.from(normalized).some((char) => { const n = char.codePointAt(0) ?? 0; return n < 32 || n === 127; })) {
      setError("Bitte eine Artikelkennung mit 1 bis 100 Zeichen ohne Zeilenumbrüche eingeben.");
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    setMessage("");
    setCode(normalized);
    try {
      const result = await lookupQr(normalized, controller.signal);
      if (controller.signal.aborted) return;
      if (result.matches.length === 0) {
        setLookup(null);
        if (preserve) setError("Der Artikel wurde nicht mehr gefunden. Bitte den QR-Code erneut scannen.");
        else if (canEdit) onCreate(result.code);
        else setError("Dieser QR-Code ist noch nicht erfasst. Für neue Artikel sind Bearbeitungsrechte erforderlich.");
        return;
      }
      setLookup(result);
      setNeedsRefresh(false);
      if (!preserve) {
        const row = result.matches[0];
        setSelectedKey(row.key);
        setLocationId(String(row.storage_location_id ?? result.locations[0]?.id ?? ""));
        setCondition(row.condition || "used");
        setQuantity("1");
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Der QR-Code konnte nicht geprüft werden.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function book(direction: "add" | "remove") {
    if (!selected || !lookup || busyRef.current || !canEdit || needsRefresh) return;
    const amount = Number(quantity);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000 || !locationId) {
      setError("Bitte einen Lagerort und eine ganze Menge zwischen 1 und 1’000’000 wählen.");
      return;
    }
    if (direction === "remove" && amount > balance) {
      setError("Die Abgangsmenge ist grösser als der verfügbare Bestand.");
      return;
    }
    busyRef.current = true;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await adjustQrStock({ code: lookup.code, product_model_id: selected.product_model_id,
        storage_location_id: Number(locationId), condition, quantity: amount, direction });
      if (!result.saved) throw new QrRequestError("Die Buchung wurde nicht bestätigt. Bitte Bestand neu prüfen.", 500);
      if (result.quantity !== null) {
        const location = lookup.locations.find((row) => String(row.id) === locationId);
        const updated: QrMatch = { ...selected, storage_location_id: Number(locationId), condition,
          ...(location ? { storage_location_name: location.storage_location_name,
            site_name: location.site_name, department_name: location.department_name } : {}),
          key: `stock:${selected.product_model_id}:${locationId}:${condition}`, quantity: result.quantity };
        setLookup((current) => current ? { ...current, matches: [
          ...current.matches.filter((row) => row.key !== updated.key), updated,
        ] } : current);
        setSelectedKey(updated.key);
      } else setNeedsRefresh(true);
      setMessage(`${direction === "add" ? "Zugang" : "Abgang"} von ${amount} Stück gespeichert.${result.quantity === null ? " Bitte den Bestand neu prüfen." : ""}`);
      void onChanged();
    } catch (cause) {
      const uncertain = cause instanceof QrRequestError && (cause.status === 0 || cause.status >= 500);
      setNeedsRefresh(uncertain);
      setError(uncertain ? "Der Buchungsstatus ist unklar. Bitte zuerst den Bestand neu prüfen, bevor du erneut buchst."
        : cause instanceof Error ? cause.message : "Die Buchung konnte nicht gespeichert werden.");
    } finally { busyRef.current = false; setSaving(false); }
  }

  async function removeAsset() {
    if (!selected || !canEdit || busyRef.current || !window.confirm(`Einzelgerät „${selected.asset_tag}“ wirklich löschen?`)) return;
    busyRef.current = true; setSaving(true); setError("");
    try {
      await deleteInventoryEntries([selected.key]);
      void onChanged();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Gerät konnte nicht gelöscht werden."); }
    finally { busyRef.current = false; setSaving(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void readCode(code); }

  return <dialog ref={dialogRef} className="qr-dialog" aria-labelledby="qr-title"
    onCancel={(event) => { event.preventDefault(); if (!busyRef.current) onClose(); }}>
    <header className="qr-dialog-header"><div><h2 id="qr-title">QR-Code einlesen</h2><p>Artikel erkennen und Bestand buchen.</p></div>
      <button type="button" aria-label="QR-Dialog schliessen" disabled={saving} onClick={onClose}>×</button></header>
    <div className="qr-dialog-body">
      {!lookup && <QrScanner disabled={loading || saving} onCode={(value) => void readCode(value)} />}
      <form className="qr-code-form" onSubmit={submit}>
        <label htmlFor="qr-code-input">Artikelkennung / QR-Code</label>
        <div><input id="qr-code-input" type="text" maxLength={100} value={code} autoComplete="off"
          disabled={saving || loading} onChange={(event) => { setCode(event.target.value); setLookup(null); setNeedsRefresh(false); }} />
          <button type="submit" disabled={!code.trim() || loading || saving}>{loading ? "Wird geprüft …" : "Prüfen"}</button></div>
      </form>
      {error && <div className="qr-error" role="alert">{error}</div>}
      {message && <div className="qr-success" role="status">{message}</div>}
      {lookup && selected && <section className="qr-result" aria-label="Gefundener Artikel">
        {lookup.matches.length > 1 && <label>Artikel / Lagerbestand
          <select aria-label="Gefundenen Artikel auswählen" value={selected.key} disabled={saving || loading}
            onChange={(event) => { const row = lookup.matches.find((item) => item.key === event.target.value); if (row) selectMatch(row); }}>
            {lookup.matches.map((row) => <option key={row.key} value={row.key}>
              {row.asset_tag || row.product_model_name} · {row.site_name} · {row.storage_location_name} · {CONDITIONS[row.condition] ?? row.condition}
            </option>)}
          </select>
        </label>}
        <h3>{selected.product_model_name}</h3>
        {selected.record_type === "asset" ? <>
          <p><strong>{selected.asset_tag}</strong> · Einzelgerät</p>
          <p>{[selected.site_name, selected.department_name, selected.storage_location_name].filter(Boolean).join(" · ")}</p>
          <p className="qr-hint">Einzelgeräte besitzen jeweils eine eigene Produkterkennung.</p>
          <div className="qr-book-buttons"><button type="button" disabled={!canEdit || saving} onClick={() => onEdit(selected.key)}>Gerät bearbeiten</button>
            <button type="button" className="qr-remove" disabled={!canEdit || saving} onClick={() => void removeAsset()}>Gerät löschen</button></div>
        </> : <>
          <label>Lagerort<select aria-label="Lagerort für QR-Buchung" value={locationId} disabled={saving || loading}
            onChange={(event) => { setLocationId(event.target.value); setError(""); setMessage(""); }}>
            <option value="">Bitte auswählen</option>
            {lookup.locations.map((row) => <option key={row.id} value={row.id}>{row.site_name} · {row.department_name} · {row.storage_location_name}</option>)}
          </select></label>
          <label>Zustand<select aria-label="Zustand für QR-Buchung" value={condition} disabled={saving || loading}
            onChange={(event) => { setCondition(event.target.value); setMessage(""); }}>
            {Object.entries(CONDITIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <div className="qr-stock-balance">Aktueller Bestand <strong>{needsRefresh ? "Bitte prüfen" : `${balance} Stück`}</strong></div>
          <label htmlFor="qr-quantity">Menge [Stück]</label><input id="qr-quantity" type="number" min="1" max="1000000" step="1"
            inputMode="numeric" value={quantity} disabled={saving || loading || !canEdit} onChange={(event) => setQuantity(event.target.value)} />
          <div className="qr-book-buttons">
            <button type="button" className="primary-button" disabled={!canEdit || saving || loading || needsRefresh || !locationId}
              onClick={() => void book("add")}>{saving ? "Wird gebucht …" : "Bestand erhöhen"}</button>
            <button type="button" className="qr-remove" disabled={!canEdit || saving || loading || needsRefresh || !locationId || balance <= 0}
              onClick={() => void book("remove")}>Bestand reduzieren</button>
          </div>
        </>}
        {!canEdit && <p className="qr-hint">Dieses Konto besitzt Leserechte.</p>}
        <button type="button" disabled={saving || loading} onClick={() => void readCode(lookup.code, true)}>Bestand neu prüfen</button>
      </section>}
    </div>
    <footer className="qr-dialog-footer">
      {lookup && <button type="button" disabled={saving || loading} onClick={() => { setLookup(null); setCode(""); setMessage(""); setError(""); }}>Weiteren Code scannen</button>}
      <button type="button" disabled={saving} onClick={onClose}>Schliessen</button>
    </footer>
  </dialog>;
}
