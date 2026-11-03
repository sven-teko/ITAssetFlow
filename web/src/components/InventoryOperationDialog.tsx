import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { loadMoveDestinations, saveInventoryOperation, type MoveDestination } from "../api/inventoryOperations";
import { QrRequestError } from "../api/qrApi";
import { newBookingId, type WithdrawalSubmission } from "../api/stockBooking";
import type { InventoryRow } from "../types/inventory";
import { getIdentifier, getRowKey } from "../utils/inventory";
import StockWithdrawalDialog from "./StockWithdrawalDialog";
import "./StockWithdrawalDialog.css";

type Props = {
  kind: "move" | "stock";
  row: InventoryRow;
  onCancel: () => void;
  onUnauthorized: () => void;
  onSuccess: (message: string) => Promise<void>;
};

export default function InventoryOperationDialog({ kind, row, onCancel, onUnauthorized, onSuccess }: Props) {
  const stock = row._record_type === "stock";
  const [balance, setBalance] = useState(Number(row.stock_quantity) || 0);
  const [quantity, setQuantity] = useState("1");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [destination, setDestination] = useState("");
  const [destinations, setDestinations] = useState<MoveDestination | null>(null);
  const [destinationError, setDestinationError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState("");
  const [withdrawal, setWithdrawal] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const model = String(row.product_model_name || getIdentifier(row));
  const source = { product_model_id: Number(row.product_model_id), storage_location_id: Number(row.storage_location_id),
    condition: String(row.condition), quantity: balance, product_model_name: model };
  const moving = kind === "move";

  useEffect(() => {
    if (withdrawal) return;
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, [withdrawal]);

  useEffect(() => {
    if (!moving) return;
    const controller = new AbortController();
    void loadMoveDestinations(controller.signal).then(value => {
      if (!controller.signal.aborted) setDestinations(value);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof QrRequestError && cause.status === 401) { onUnauthorized(); return; }
      setDestinationError(cause instanceof Error ? cause.message : "Ziellagerorte konnten nicht geladen werden.");
    });
    return () => controller.abort();
  }, [moving, attempt, onUnauthorized]);

  const options = (destinations?.storage_locations ?? [])
    .filter(location => location.is_active !== false && location.department_id != null && String(location.id) !== String(row.storage_location_id))
    .map(location => ({ id: location.id, label: [
      destinations?.sites.find(site => site.id === location.site_id)?.name,
      destinations?.departments.find(dep => dep.id === location.department_id)?.name,
      location.name,
    ].filter(Boolean).join(" · ") }))
    .sort((a, b) => a.label.localeCompare(b.label, "de-CH"));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const amount = stock ? Number(quantity) : 1;
    if (!pending.current) {
      if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
        setError("Bitte eine gültige ganze Stückzahl eingeben.");
        return;
      }
      if (stock && (moving || direction === "remove") && amount > balance) {
        setError("Die Menge übersteigt den verfügbaren Bestand.");
        return;
      }
      if (!moving && direction === "remove") { setError(""); setWithdrawal(true); return; }
      pending.current = moving ? {
        request_id: newBookingId(), entry_key: getRowKey(row), destination_id: Number(destination),
        quantity: stock ? amount : null, expected_quantity: stock ? balance : null,
        expected_location_id: source.storage_location_id || null, note: note.trim() || null,
      } : {
        request_id: newBookingId(), product_model_id: source.product_model_id, storage_location_id: source.storage_location_id,
        condition: source.condition, quantity: amount, expected_quantity: balance, direction: "add",
      };
    }
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      await saveInventoryOperation(kind, pending.current);
      const booked = Number(pending.current.quantity ?? 1);
      pending.current = null;
      await onSuccess(moving ? (stock ? `${booked} Stück wurden umgelagert.` : "Der Artikel wurde umgelagert.")
        : `${booked} Stück wurden zum Lagerbestand hinzugefügt.`);
    } catch (cause) {
      if (cause instanceof QrRequestError && cause.status === 401) { onUnauthorized(); return; }
      const unknown = cause instanceof QrRequestError && (cause.status === 0 || cause.status >= 500);
      setUncertain(unknown);
      if (!unknown) pending.current = null;
      if (cause instanceof QrRequestError && cause.status === 409 && cause.available !== undefined) setBalance(cause.available);
      setError(unknown ? "Die Buchung wurde nicht bestätigt. Dieselbe Buchung kann ohne Doppelbuchung erneut geprüft werden."
        : cause instanceof Error ? cause.message : "Die Buchung konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  async function remove(submission: WithdrawalSubmission) {
    try {
      await saveInventoryOperation("stock", {
        request_id: submission.request_id, quantity: submission.quantity, expected_quantity: submission.expected_quantity,
        withdrawal: submission.withdrawal, direction: "remove", product_model_id: source.product_model_id,
        storage_location_id: source.storage_location_id, condition: source.condition,
      });
      await onSuccess(`${submission.quantity} Stück wurden aus dem Lagerbestand entnommen.`);
    } catch (cause) {
      if (cause instanceof QrRequestError && cause.status === 401) { onUnauthorized(); return; }
      if (cause instanceof QrRequestError && cause.status === 409 && cause.available !== undefined) setBalance(cause.available);
      throw cause;
    }
  }

  if (withdrawal) return <StockWithdrawalDialog source={source} amount={Number(quantity)}
    onCancel={() => setWithdrawal(false)} onConfirm={remove}/>;

  return createPortal(
    <dialog ref={dialog} className="stock-withdrawal" aria-labelledby="inventory-operation-title" onCancel={event => {
      event.preventDefault();
      if (!busy) onCancel();
    }}>
      <form onSubmit={event => void submit(event)}>
        <header>
          <h2 id="inventory-operation-title">{moving ? "Umlagern" : "Lagerbestand ändern"}</h2>
          <p>{stock ? model : getIdentifier(row)}{stock ? ` · ${balance} Stück verfügbar` : ""}</p>
          <p>{[row.site_name, row.department_name, row.storage_location].filter(Boolean).join(" · ")}</p>
        </header>
        <fieldset disabled={busy || uncertain}>
          {moving ? <>
            {destinationError ? <p role="alert">{destinationError} <button type="button" onClick={() => { setDestinationError(""); setAttempt(n => n + 1); }}>Erneut laden</button></p>
              : !destinations ? <p role="status">Ziellagerorte werden geladen …</p>
              : <label>Ziellagerort *
                <select required value={destination} onChange={event => setDestination(event.target.value)}>
                  <option value="">{options.length ? "Bitte auswählen" : "Kein anderer freigegebener Lagerort"}</option>
                  {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>}
            {!stock && <p>Eine Mitarbeiterzuweisung bleibt bestehen, wenn die Person zur Abteilung des Ziellagerorts gehört.</p>}
            <label>Bemerkung<textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)}/></label>
          </> : <label>Buchungsart
            <select value={direction} onChange={event => setDirection(event.target.value === "remove" ? "remove" : "add")}>
              <option value="add">Zugang</option><option value="remove">Entnahme</option>
            </select>
          </label>}
          {stock && <label>Menge [Stück] *
            <input type="number" required min={1} max={moving || direction === "remove" ? balance : 1000000}
              step={1} value={quantity} onChange={event => setQuantity(event.target.value)}/>
          </label>}
        </fieldset>
        {error && <p role="alert" className="archive-error">{error}</p>}
        <footer>
          <button type="button" onClick={onCancel} disabled={busy}>{uncertain ? "Schliessen" : "Abbrechen"}</button>
          <button type="submit" className="primary-button" disabled={busy || (moving && !destination)}>
            {busy ? "Wird gebucht …" : uncertain ? "Buchung erneut prüfen" : moving ? "Umlagern" : direction === "remove" ? "Weiter zur Entnahme" : "Zugang buchen"}
          </button>
        </footer>
      </form>
    </dialog>, document.body,
  );
}
