import { useEffect, useRef, useState, type FormEvent } from "react";
import { adjustQrStock, lookupQr, QrRequestError, type QrLookup, type QrMatch } from "../api/qrApi";
import QrScanner from "./QrScanner";
import QrDeviceDetails from "./QrDeviceDetails";
import StockWithdrawalDialog from "./StockWithdrawalDialog";
import { newBookingId, type WithdrawalSubmission } from "../api/stockBooking";
import "./QrWorkflowDialog.css";
import { isValidEan, isValidUpc, identifierType, labelledCodes, type CodeType, type ScanDraft } from "../utils/scannerCodes";
import { assignedCodes, proposeAssignments, resolveScannerBatch, resolveScannerCandidates, scanLabels, type Assignment } from "../utils/scannerBatch";
import type { ScannedCode } from "../utils/barcodeReader";

type Props = {
  onArchive: (key: string) => void;
  canEdit: boolean;
  onClose: () => void;
  onCreate: (code: string, type: CodeType, format: string, draft?: ScanDraft) => void;
  onEdit: (key: string) => void;
  onChanged: () => Promise<void>;
};

const CONDITIONS: Record<string, string> = { new: "Neu", like_new: "Neuwertig", used: "Gebraucht", worn: "Abgenutzt", defective: "Defekt" };
type StockTarget = { code: string; product_model_id: number; storage_location_id: number; condition: string };
type AddBooking = StockTarget & { direction: "add"; quantity: number; request_id: string };

export default function QrWorkflowDialog({ canEdit, onClose, onCreate, onEdit, onChanged, onArchive }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const pendingAdd = useRef<AddBooking | null>(null);
  const [withdrawalOpen,setWithdrawalOpen]=useState(false);
  const [addPending,setAddPending]=useState(false);
  const [code, setCode] = useState("");
  const [recognizedType, setRecognizedType] = useState<CodeType | null>(null);
  const [recognizedFormat, setRecognizedFormat] = useState("");
  const [lookup, setLookup] = useState<QrLookup | null>(null);
  const [createDraft, setCreateDraft] = useState<ScanDraft | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [detailsKey, setDetailsKey] = useState("");
  const [locationId, setLocationId] = useState("");
  const [condition, setCondition] = useState("used");
  const [quantity, setQuantity] = useState("1");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ codes: ScannedCode[]; assignments: Assignment[] } | null>(null);
  const [extraCode, setExtraCode] = useState("");
  const [collectingMore, setCollectingMore] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { requestRef.current?.abort(); dialog?.close(); };
  }, []);

  const selected = lookup?.matches.find((row) => row.key === selectedKey);
  const balance = lookup?.matches.find((row) => row.record_type === "stock"
    && row.product_model_id === selected?.product_model_id
    && String(row.storage_location_id) === locationId && row.condition === condition)?.quantity ?? 0;

  function selectMatch(row: QrMatch) {
    if (busyRef.current || pendingAdd.current) return;
    setSelectedKey(row.key);
    setDetailsKey("");
    setLocationId(String(row.storage_location_id ?? lookup?.locations[0]?.id ?? ""));
    setCondition(row.condition || "used");
    setQuantity("1");
    setMessage("");
  }

  function applyLookup(result: QrLookup, type: CodeType, format: string, preserve = false, draft?: ScanDraft) {
    setDetailsKey("");
    const candidate = draft ?? (preserve ? createDraft : null);
    const model = result.models?.find(row => row.id === candidate?.modelId);
    const createFromModel = candidate?.asset_tag && candidate.ean && candidate.modelId !== undefined &&
      !result.direct_asset_keys?.length && (model ? model.tracking_mode === "serialized" || model.tracking_mode === "hybrid" :
        result.matches.some(row => row.record_type === "asset" && row.product_model_id === candidate.modelId));
    setCreateDraft(createFromModel ? candidate : null);
    if (!result.matches.length && !createFromModel) {
      setLookup(null);
      if (preserve) setError("Der Artikel wurde nicht mehr gefunden. Bitte den Code erneut scannen.");
      else if (canEdit) onCreate(result.code, result.code_type ?? type, format, draft);
      else setError("Dieser Code ist noch nicht erfasst. Für neue Artikel sind Bearbeitungsrechte erforderlich.");
      return;
    }
    setReview(null);
    setLookup(result);
    setRecognizedType(result.code_type ?? type);
    setNeedsRefresh(false);
    if (!preserve || !result.matches.some(row => row.key === selectedKey)) {
      const preferred = result.matches.find(row => row.key === result.preferred_key);
      const row = preferred ?? result.matches[0];
      setSelectedKey(preferred || result.matches.length === 1 ? row.key : "");
      setLocationId(String(row?.storage_location_id ?? result.locations[0]?.id ?? ""));
      setCondition(row?.condition || "used");
      setQuantity("1");
    }
  }

  async function detectedCodes(codes: ScannedCode[], automatic = true) {
    if (codes.length === 1 && !/^(?:IPUI|IPEI|SAP|P\/N)\s*[:=]/i.test(codes[0].text)) {
      const only = codes[0];
      void readCode(only.text, false, only.type, only.format, only.labelled);
      return;
    }
    setError("");
    setExtraCode("");
    setReview({ codes, assignments: proposeAssignments(codes) });
    if (!automatic) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const hit = await resolveScannerCandidates(codes, controller.signal);
      if (!controller.signal.aborted && hit && (hit.lookup.device_match_keys?.length || hit.draft?.modelId !== undefined || hit.draft?.newModel && canEdit)) {
        setCode(hit.lookup.code);
        setRecognizedFormat(hit.primary.format ?? "");
        applyLookup(hit.lookup, hit.primary.role, hit.primary.format ?? "", false, hit.draft);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Die Codes konnten nicht geprüft werden.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function addScannedCodes(codes: ScannedCode[]) {
    if (!review) return;
    const next = [...review.codes];
    for (const code of codes) {
      if (!next.some(previous => previous.text === code.text && previous.type === code.type) && next.length < 10) next.push(code);
    }
    const suggestions = proposeAssignments(next);
    const assignments = next.map((_, index) => review.assignments[index] ?? suggestions[index]);
    setReview({ codes: next, assignments });
    setCollectingMore(false);
    setError("");
  }

  function addMissingCode(event: FormEvent) {
    event.preventDefault();
    if (!review || loading || !extraCode.trim() || review.codes.length >= 10) return;
    const labelled = labelledCodes(extraCode)[0];
    const text = labelled?.text ?? extraCode.trim();
    const type = labelled?.type ?? identifierType(text);
    if (!review.codes.some(code => code.text === text && code.type === type)) {
      setReview({ codes: [...review.codes, { text, type, format: "Eingabe" }], assignments: [...review.assignments, type] });
    }
    setExtraCode("");
    setError("");
  }

  async function readBatch() {
    if (!review || loading) return;
    setError("");
    let draft: ScanDraft;
    try { draft = assignedCodes(review.codes, review.assignments); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Bitte die Zuordnung prüfen."); return; }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const result = await resolveScannerBatch(draft, controller.signal);
      if (controller.signal.aborted) return;
      const format = review.codes[review.assignments.indexOf(result.role)]?.format ?? "";
      setCode(result.lookup.code);
      setRecognizedFormat(format);
      applyLookup(result.lookup, result.role, format, false, result.draft);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Die Codes konnten nicht geprüft werden.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function readCode(value: string, preserve = false, detectedType: CodeType = "auto", format = "", labelledDetection = false) {
    if (busyRef.current) return;
    const labelled = detectedType === "auto" ? labelledCodes(value) : [];
    if (labelled.length > 1) { void detectedCodes(labelled.map(field => ({ ...field, format: "Eingabe", labelled: true })), false); return; }
    const normalized = labelled[0]?.text ?? value.trim();
    if (!normalized || normalized.length > 100 || Array.from(normalized).some((char) => { const n = char.codePointAt(0) ?? 0; return n < 32 || n === 127; })) {
      setError("Bitte eine Artikelkennung mit 1 bis 100 Zeichen ohne Zeilenumbrüche eingeben.");
      return;
    }
    const type = labelled[0]?.type ?? (detectedType === "auto" ? identifierType(normalized, format) : detectedType);
    if (type === "asset_tag" && normalized.length > 50) { setError("Die Produkterkennung darf höchstens 50 Zeichen enthalten."); return; }
    if (type === "ean" && !isValidEan(normalized)) { setError("Die EAN muss 8 oder 13 Ziffern und eine gültige Prüfziffer enthalten."); return; }
    if (type === "upc" && !isValidUpc(normalized)) { setError("Die UPC-A muss 12 Ziffern und eine gültige Prüfziffer enthalten."); return; }
    setRecognizedType(type);
    setRecognizedFormat(format);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    setMessage("");
    setCode(normalized);
    try {
      const explicit = labelledDetection || labelled.length > 0;
      const ambiguousTag = type === "asset_tag" && !explicit && !preserve;
      const response = await lookupQr(normalized, controller.signal, ambiguousTag ? "auto" : type);
      if (controller.signal.aborted) return;
      const result = ambiguousTag && response.code_type === "auto" ? { ...response, code_type: type } : response;
      if (!preserve && type === "upc" && !result.matches.length && !result.models?.length) {
        setReview({ codes: [{ text: normalized, type, format: format || "UPC-A" }], assignments: ["upc"] });
        setExtraCode("");
        setError("Diese UPC ist noch nicht hinterlegt. Scanne oder ergänze die EAN, falls sie auf dem Etikett steht.");
        return;
      }
      const directKeys = new Set(result.direct_asset_keys);
      const exactDevice = directKeys.size > 0;
      const draft = type === "asset_tag" && explicit ? { asset_tag: normalized } : undefined;
      applyLookup(exactDevice ? { ...result, preferred_key: null, matches: result.matches.filter(row => directKeys.has(row.key)) }
        : result, type, format, preserve, draft);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Der Code konnte nicht geprüft werden.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function book(direction: "add" | "remove", withdrawal?:WithdrawalSubmission) {
    const retry = direction === "add" ? pendingAdd.current : null;
    if (selected?.record_type !== "stock" || !lookup || busyRef.current || !canEdit
      || (pendingAdd.current && !retry) || (needsRefresh && !withdrawal && !retry)) return;
    const amount = retry?.quantity ?? withdrawal?.quantity ?? Number(quantity);
    const target: StockTarget = retry ?? { code: lookup.code, product_model_id: selected.product_model_id,
      storage_location_id: Number(locationId), condition };
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000 || !target.storage_location_id) {
      setError("Bitte einen Lagerort und eine ganze Menge zwischen 1 und 1’000’000 wählen.");
      return;
    }
    if (direction === "remove" && amount > balance) {
      setError("Die Abgangsmenge ist grösser als der verfügbare Bestand.");
      return;
    }
    if(direction === "remove" && !withdrawal){setWithdrawalOpen(true);return;}
    const addition: AddBooking | null = direction === "add"
      ? retry ?? { ...target, direction: "add", quantity: amount, request_id: newBookingId() } : null;
    const payload = addition ?? { ...target, direction, ...withdrawal };
    if (addition) { pendingAdd.current = addition; setAddPending(true); }
    busyRef.current = true;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await adjustQrStock(payload);
      if (!result.saved) throw new QrRequestError("Die Buchung wurde nicht bestätigt. Bitte Bestand neu prüfen.", 500);
      pendingAdd.current = null; setAddPending(false); setWithdrawalOpen(false); setNeedsRefresh(false);
      if (result.quantity !== null) {
        const { product_model_id, storage_location_id, condition: bookedCondition } = target;
        const location = lookup.locations.find(row => row.id === storage_location_id);
        const updated: QrMatch = { ...selected, product_model_id, storage_location_id, condition: bookedCondition,
          ...(location ? { storage_location_name: location.storage_location_name,
            site_name: location.site_name, department_name: location.department_name } : {}),
          key: `stock:${product_model_id}:${storage_location_id}:${bookedCondition}`, quantity: result.quantity };
        setLookup((current) => current ? { ...current, matches: [
          ...current.matches.filter((row) => row.key !== updated.key), updated,
        ] } : current);
        setSelectedKey(updated.key);
        setLocationId(String(storage_location_id)); setCondition(bookedCondition);
      } else setNeedsRefresh(true);
      setMessage(`${direction === "add" ? "Zugang" : result.asset_count ? "Übernahme als Einzelartikel" : "Entnahme ins Archiv"} von ${result.changed_quantity} Stück gespeichert.${result.quantity === null ? " Bitte den Bestand neu prüfen." : ""}`);
      void onChanged();
    } catch (cause) {
      const uncertain = !!retry || (cause instanceof QrRequestError && (cause.status === 0 || cause.status >= 500));
      setNeedsRefresh(uncertain);
      if (!uncertain) {pendingAdd.current=null;setAddPending(false);}
      if(withdrawal) throw cause;
      setError(uncertain ? "Der Buchungsstatus ist unklar. Wähle «Buchung erneut prüfen», um die ursprüngliche Buchung zu klären."
        : cause instanceof Error ? cause.message : "Die Buchung konnte nicht gespeichert werden.");
    } finally { busyRef.current = false; setSaving(false); }
  }

  async function removeAsset() {
    if (selected && canEdit && !busyRef.current) onArchive(selected.key);
  }

  function submit(event: FormEvent) { event.preventDefault(); void readCode(code); }

  return (
    <><dialog ref={dialogRef} className="qr-dialog" aria-labelledby="qr-title"
      onCancel={event => { event.preventDefault(); if (!busyRef.current && !addPending) onClose(); }}>
      <header className="qr-dialog-header">
        <div><h2 id="qr-title">Scanner</h2><p>Artikel erkennen und Bestand buchen.</p></div>
        <button type="button" className="qr-close-button" aria-label="Scanner schliessen" disabled={saving||addPending} onClick={onClose}>×</button>
      </header>

      <div className="qr-dialog-body">
        {review && collectingMore ? <section className="qr-code-review" aria-label="Weiteren Code hinzufügen">
          <QrScanner disabled={saving} onCodes={addScannedCodes} />
          <button type="button" onClick={() => setCollectingMore(false)}>Zurück zur Zuordnung</button>
        </section> : review ? <section className="qr-code-review" aria-label="Erkannte Codes zuordnen">
          <h3>Erkannte Codes zuordnen</h3>
          {review.codes.map((item, index) => <label key={`${item.type}:${item.text}`}>
            <span><strong>{item.text}</strong><small>{item.format}</small></span>
            <select aria-label={`Zuordnung für ${item.text}`} value={review.assignments[index]} disabled={loading}
              onChange={event => {
                const choice = event.target.value as Assignment;
                setReview({ ...review, assignments: review.assignments.map((role, i) => i === index ? choice : role) });
                setError("");
              }}>
              {Object.entries(scanLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
            </select>
          </label>)}
          {review.codes.length < 10 && <form className="qr-code-form" onSubmit={addMissingCode}>
            <label htmlFor="scanner-extra-code">Fehlende Kennung ergänzen</label>
            <div className="qr-code-input-row">
              <input id="scanner-extra-code" value={extraCode} maxLength={100} disabled={loading}
                onChange={event => setExtraCode(event.target.value)} />
              <button type="submit" disabled={loading || !extraCode.trim()}>Hinzufügen</button>
            </div>
          </form>}
          <div className="qr-camera-controls">
            <button type="button" className="primary-button" disabled={loading} onClick={() => void readBatch()}>{loading ? "Codes werden geprüft …" : "Zuordnung prüfen"}</button>
            {review.codes.length < 10 && <button type="button" disabled={loading} onClick={() => { setCollectingMore(true); setError(""); }}>Weiteren Code scannen</button>}
            <button type="button" disabled={loading} onClick={() => { setReview(null); setError(""); }}>Neu scannen</button>
          </div>
        </section> : !lookup ? <>
          {loading ? <div className="qr-camera" role="status">Code wird geprüft …</div>
            : <QrScanner disabled={saving} onCodes={detectedCodes} />}
          <div className="qr-section-divider"><span>oder manuell eingeben</span></div>
          <form className="qr-code-form" onSubmit={submit}>
            <label htmlFor="qr-code-input">Code eingeben</label>
            <div className="qr-code-input-row">
              <input id="qr-code-input" type="text" maxLength={100} value={code} autoComplete="off" spellCheck={false}
                aria-label="QR-Code / EAN / Artikelkennung" placeholder="Barcode oder Artikelkennung"
                disabled={saving || loading} onChange={event => { setCode(event.target.value); setRecognizedType(null); setNeedsRefresh(false); setError(""); }} />
              <button type="submit" disabled={!code.trim() || loading || saving}>{loading ? "Wird geprüft …" : "Prüfen"}</button>
            </div>
          </form>
        </> : <div className="qr-detected-code">
          <div><span className="qr-code-caption">Erkannter Code</span><strong>{lookup.code}</strong></div>
          <span className="qr-code-badge">{recognizedFormat ? `${recognizedFormat} · ` : ""}{recognizedType === "asset_tag" ? "Produkterkennung" : recognizedType === "mac" ? "MAC-Adresse" : recognizedType === "serial" ? "Seriennummer" : recognizedType === "ean" ? "EAN" : recognizedType === "upc" ? "UPC" : "QR-Code"}</span>
        </div>}

        {error && <div className="qr-error" role="alert">{error}</div>}
        {message && <div className="qr-success" role="status">{message}</div>}

        {lookup && <section className="qr-result" aria-label="Gefundener Artikel">
          {!lookup.matches.length && createDraft && <div className="qr-result-heading">
            <h3>{lookup.models?.find(model => model.id === createDraft.modelId)?.name ?? "Produktmodell"}</h3>
            <p>Zu diesem Modell sind noch keine Artikel erfasst.</p>
          </div>}
          {!selected && (recognizedType === "ean" || recognizedType === "upc") && lookup.matches.length > 1
            && lookup.matches.every(row => row.product_model_id === lookup.matches[0].product_model_id)
            && <div><h3>{lookup.matches[0].product_model_name}</h3><p>{lookup.matches.length} Einträge zum Produktmodell</p></div>}
          {lookup.matches.length > 1 && <label>Artikel auswählen
            <select aria-label="Gefundenen Artikel auswählen" value={selected?.key ?? ""} disabled={saving || loading || addPending}
              onChange={event => { const row = lookup.matches.find(item => item.key === event.target.value); if (row) selectMatch(row); }}>
              <option value="" disabled>Bitte einen passenden Eintrag auswählen</option>
              {lookup.matches.map(row => <option key={row.key} value={row.key}>
                {lookup.device_match_keys?.includes(row.key) ? "Gerät erkannt: " : ""}{row.asset_tag || row.product_model_name} · {row.site_name} · {row.storage_location_name} · {CONDITIONS[row.condition] ?? row.condition}
              </option>)}
            </select>
          </label>}

          {selected && <>
            <div className="qr-result-heading"><h3>{selected.product_model_name}</h3>
              <span>{selected.record_type === "asset" ? "Einzelgerät" : "Mengenartikel"}</span></div>
            {selected.record_type === "asset" ? <>
              <p className="qr-asset-identifier">{selected.asset_tag}</p>
              <p className="qr-hint">{[selected.site_name, selected.department_name, selected.storage_location_name].filter(Boolean).join(" · ")}</p>
              <div className="qr-book-buttons">
                <button type="button" className="primary-button" disabled={loading || saving}
                  aria-expanded={detailsKey === selected.key}
                  onClick={() => setDetailsKey(detailsKey === selected.key ? "" : selected.key)}>
                  {detailsKey === selected.key ? "Details ausblenden" : "Details anzeigen"}
                </button>
                {canEdit && <>
                  <button type="button" disabled={loading || saving} onClick={() => onEdit(selected.key)}>Gerät bearbeiten</button>
                  <button type="button" className="qr-remove" disabled={loading || saving} onClick={() => void removeAsset()}>Gerät löschen</button>
                </>}
              </div>
              {detailsKey === selected.key && <QrDeviceDetails key={selected.key} assetKey={selected.key} />}
            </> : <>
              <div className="qr-stock-balance"><span>Aktueller Bestand</span><strong>{needsRefresh ? "Bitte prüfen" : `${balance} Stück`}</strong></div>
              <div className="qr-result-fields">
                <label className="qr-location-field">Lagerort
                  <select aria-label="Lagerort für Scanner-Buchung" value={locationId} disabled={saving || loading || addPending}
                    onChange={event => { setLocationId(event.target.value); setError(""); setMessage(""); }}>
                    <option value="">Bitte auswählen</option>
                    {lookup.locations.map(row => <option key={row.id} value={row.id}>{row.site_name} · {row.department_name} · {row.storage_location_name}</option>)}
                  </select>
                </label>
                <label>Zustand
                  <select aria-label="Zustand für Scanner-Buchung" value={condition} disabled={saving || loading || addPending}
                    onChange={event => { setCondition(event.target.value); setError(""); setMessage(""); }}>
                    {Object.entries(CONDITIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                <label htmlFor="qr-quantity">Menge [Stück]
                  <input id="qr-quantity" type="number" min="1" max="1000000" step="1" inputMode="numeric" value={quantity}
                    disabled={saving || loading || !canEdit || addPending} onChange={event => setQuantity(event.target.value)} />
                </label>
              </div>
              <div className="qr-book-buttons">
                <button type="button" className="primary-button" disabled={!canEdit || saving || loading || needsRefresh || !locationId}
                  onClick={() => void book("add")}>{saving ? "Wird gebucht …" : "Bestand erhöhen"}</button>
                <button type="button" className="qr-remove" disabled={!canEdit || saving || loading || needsRefresh || !locationId || balance <= 0}
                  onClick={() => void book("remove")}>Bestand reduzieren</button>
              </div>
            </>}
          </>}
          {canEdit && createDraft && <div className="qr-book-buttons">
            <button type="button" className="primary-button" disabled={saving || loading || addPending}
              onClick={() => onCreate(lookup.code, recognizedType ?? "ean", recognizedFormat, createDraft)}>
              Neuen Einzelartikel erfassen
            </button>
          </div>}
          {!canEdit && <p className="qr-hint">Dieses Konto besitzt Leserechte.</p>}
          <button type="button" className="qr-refresh-button" disabled={saving || loading}
            onClick={() => pendingAdd.current ? void book("add") : void readCode(lookup.code, true, recognizedType ?? "auto", recognizedFormat)}>{addPending?"Buchung erneut prüfen":"Bestand neu prüfen"}</button>
        </section>}
      </div>

      <footer className="qr-dialog-footer">
        {lookup && <button type="button" className="qr-next-button" disabled={saving || loading || addPending} onClick={() => {
          setLookup(null); setCreateDraft(null); setCode(""); setRecognizedType(null); setRecognizedFormat(""); setNeedsRefresh(false); setMessage(""); setError("");
        }}>Weiteren Code scannen</button>}
        <button type="button" disabled={saving||addPending} onClick={onClose}>Schliessen</button>
      </footer>
    </dialog>{withdrawalOpen && selected && <StockWithdrawalDialog source={{product_model_id:selected.product_model_id,storage_location_id:Number(locationId),condition,quantity:balance,product_model_name:selected.product_model_name}}
      amount={Number(quantity)} onCancel={()=>setWithdrawalOpen(false)} onConfirm={submission=>book("remove",submission)}/>}</>
  );
}
