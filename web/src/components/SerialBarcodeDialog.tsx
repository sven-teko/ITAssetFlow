import { useEffect, useRef, useState } from "react";
import type { ScannedCode } from "../utils/barcodeReader";
import QrScanner from "./QrScanner";
import "./QrWorkflowDialog.css";

function serialCandidates(codes: ScannedCode[]): string[] {
  const labelled = codes.filter(code => code.labelled && code.type === "serial");
  const candidates = labelled.length ? labelled : codes.filter(code =>
    !code.labelled && (code.type === "serial" || code.type === "asset_tag" || code.type === "mac") &&
    (code.format === "Code 128" || code.format === "Code 39") &&
    !/^(?:IPUI|IPEI|SAP|P\/N|EAN(?:-8|-13)?|UPC(?:-A)?|MAC(?:[- ]?(?:Adresse|Address|ID))?)\s*[:=]/i.test(code.text));
  return [...new Set(candidates.map(code => code.text.trim()).filter(value =>
    value && value.length <= 100 && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)))];
}

export default function SerialBarcodeDialog({ onCancel, onSelect }: { onCancel: () => void; onSelect: (serial: string) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function read(codes: ScannedCode[]) {
    const values = serialCandidates(codes);
    setCandidates(values);
    setError(values.length ? "" : "Kein Seriennummern-Barcode gefunden. Halte nur den Barcode bei «SN» oder «Serial Number» in den Rahmen.");
  }

  return <dialog ref={dialogRef} className="qr-dialog" aria-labelledby="serial-scan-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <header className="qr-dialog-header">
      <div><h2 id="serial-scan-title">Seriennummer scannen</h2><p>Halte den Barcode der Seriennummer in den weissen Rahmen.</p></div>
      <button type="button" className="qr-close-button" aria-label="Seriennummernscanner schliessen" onClick={onCancel}>×</button>
    </header>
    <div className="qr-dialog-body">
      {candidates.length ? <div className="qr-code-review serial-scan-results">
        <p>{candidates.length === 1 ? "Erkannte Seriennummer übernehmen?" : "Welche Seriennummer möchtest du übernehmen?"}</p>
        {candidates.map(value => <button type="button" className="primary-button" key={value} onClick={() => onSelect(value)}>{value} übernehmen</button>)}
        <button type="button" onClick={() => setCandidates([])}>Erneut scannen</button>
      </div> : <QrScanner onCodes={read} disabled={false} serialOnly />}
      {error && <p role="alert" className="qr-error">{error}</p>}
    </div>
  </dialog>;
}
