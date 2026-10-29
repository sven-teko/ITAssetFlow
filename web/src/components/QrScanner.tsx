import { useCallback, useEffect, useRef, useState } from "react";
import type { CodeType } from "../utils/scannerCodes";
import type { ScannedCode } from "../utils/barcodeReader";

type Props = { onCode: (code: string, type: CodeType, format: string) => void; disabled: boolean };
type CameraCapabilities = MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number; step: number }; torch?: boolean };
type CameraSetting = MediaTrackConstraintSet & { focusMode?: string; zoom?: number; torch?: boolean };
type CameraTools = { zoom?: { min: number; max: number; step: number }; torch: boolean };

function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Kamerazugriff nicht erlaubt. Bitte die Kameraberechtigung für diese Webseite im Browser freigeben.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Keine Kamera gefunden. Du kannst stattdessen ein Code-Bild öffnen oder die Kennung eingeben.";
  if (name === "NotReadableError") return "Die Kamera ist belegt oder konnte nicht gestartet werden. Bitte andere Kamera-Anwendungen schliessen.";
  return "Die Kamera konnte nicht gestartet werden. Bitte HTTPS, Kameraberechtigung und Kamera prüfen.";
}

export default function QrScanner({ onCode, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [tools, setTools] = useState<CameraTools>({ torch: false });
  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [error, setError] = useState("");

  const release = useCallback(() => {
    generation.current += 1;
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release(); setActive(false); setStarting(false); setReadingImage(false); setTools({ torch: false }); setTorch(false);
  }, [release]);

  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); release(); };
  }, [release, stop]);

  async function start() {
    stop(); setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Für den Kamerazugriff ist eine vertrauenswürdige HTTPS-Verbindung erforderlich. Alternativ Code-Bild öffnen oder Kennung eingeben.");
      return;
    }
    const run = generation.current;
    setStarting(true);
    let stage: "decoder" | "camera" = "decoder";
    try {
      const { createBarcodeReader } = await import("../utils/barcodeReader");
      const read = await createBarcodeReader();
      if (run !== generation.current) return;
      stage = "camera";
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24, max: 30 },
      } });
      if (run !== generation.current || !videoRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const capabilities: CameraCapabilities = track?.getCapabilities?.() ?? {};
      if (capabilities.focusMode?.includes("continuous")) {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as CameraSetting] }).catch(() => {});
      }
      if (run !== generation.current || !videoRef.current) return;
      const zoomRange = capabilities.zoom && capabilities.zoom.max > capabilities.zoom.min
        ? { min: capabilities.zoom.min, max: Math.min(capabilities.zoom.max, Math.max(4, capabilities.zoom.min)), step: capabilities.zoom.step || 0.1 } : undefined;
      setTools({ zoom: zoomRange, torch: capabilities.torch === true });
      setZoom((track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom ?? zoomRange?.min ?? 1);
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (run !== generation.current) return;
      setActive(true); setStarting(false);
      let candidate = "", confirmations = 0, attempts = 0;
      const scan = async () => {
        if (run !== generation.current || !videoRef.current) return;
        try {
          const result = await read(videoRef.current, ++attempts % 3 === 0);
          if (run !== generation.current) return;
          if (result) {
            const key = `${result.format}:${result.text}`;
            confirmations = key === candidate ? confirmations + 1 : 1;
            candidate = key;
            // Two matching frames reduce accidental readings of linear barcodes.
            if (result.type === "qr" || confirmations >= 2) {
              stop(); onCode(result.text, result.type, result.format); return;
            }
          } else { candidate = ""; confirmations = 0; }
        } catch {
          if (run !== generation.current) return;
          stop(); setError("Das Kamerabild konnte nicht gelesen werden. Bitte die Kamera erneut starten oder ein Bild öffnen."); return;
        }
        timerRef.current = window.setTimeout(() => void scan(), 180);
      };
      void scan();
      const cameras = (await navigator.mediaDevices.enumerateDevices().catch(() => []))
        .filter(device => device.kind === "videoinput");
      if (run === generation.current) setDevices(cameras);
    } catch (cause) {
      if (run !== generation.current) return;
      stop(); setError(stage === "decoder" ? "Der Scanner konnte nicht geladen werden. Bitte die Seite neu laden und sicherstellen, dass das vollständige Update installiert ist." : cameraError(cause));
    }
  }

  async function changeCamera(setting: CameraSetting) {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const run = generation.current;
    try {
      await track.applyConstraints({ advanced: [setting] });
      if (run !== generation.current) return;
      if (setting.zoom !== undefined) setZoom(setting.zoom);
      if (setting.torch !== undefined) setTorch(setting.torch);
    } catch { if (run === generation.current) setError("Diese Kameraeinstellung konnte nicht angewendet werden."); }
  }

  async function readImage(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    stop(); setError("");
    if (file.size > 15 * 1024 * 1024) { setError("Bitte ein Bild unter 15 MB auswählen."); input.value = ""; return; }
    const run = generation.current;
    const url = URL.createObjectURL(file);
    setReadingImage(true);
    let detected: ScannedCode | null = null;
    try {
      const { createBarcodeReader } = await import("../utils/barcodeReader");
      const read = await createBarcodeReader();
      const image = new Image(); image.src = url;
      await image.decode();
      if (run !== generation.current) return;
      detected = await read(image, true);
      if (!detected && run === generation.current) setError("Kein lesbarer Code gefunden. Bitte nur einen Code möglichst nah, scharf und mit etwas freiem Rand aufnehmen. Unterstützt: QR, EAN, Code 128 und Code 39.");
    } catch {
      if (run === generation.current) setError("Das Code-Bild oder der Scanner konnte nicht geladen werden. Bitte ein scharfes Bild öffnen und die Seite bei Bedarf neu laden.");
    } finally {
      URL.revokeObjectURL(url); input.value = "";
      if (run === generation.current) setReadingImage(false);
    }
    if (detected && run === generation.current) onCode(detected.text, detected.type, detected.format);
  }

  return <section className={`qr-camera${active ? " is-active" : ""}`} aria-label="Scanner">
    <div className="qr-capture-heading">
      <span className="qr-auto-label"><span aria-hidden="true">✓</span> Automatische Erkennung</span>
      {(active || starting) && <span className="qr-camera-status" role="status">{starting ? "Kamera startet …" : "Kamera aktiv"}</span>}
    </div>
    {!active && <div className="qr-camera-intro">
      <span className="qr-camera-symbol" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 5.5 9.5 3h5L16 5.5h3A2 2 0 0 1 21 7.5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12.5" r="4" />
        </svg>
      </span>
      <div><h3>Mit Kamera scannen</h3><p>QR, EAN, Code 128 und Code 39 – ohne Auswahl der Codeart.</p></div>
    </div>}
    <div className={`qr-video-wrap${active ? " active" : ""}`}>
      <video ref={videoRef} muted playsInline autoPlay aria-label="Kamerabild für QR-Code oder Barcode" />
      {active && <span className="qr-scan-frame" aria-hidden="true" />}
    </div>
    {active && <p className="qr-hint">Einen Code nah und scharf aufnehmen. Alle Striche und den freien Rand im Bild halten.</p>}
    {active && (tools.zoom || tools.torch) && <div className="qr-camera-tools">
      {tools.zoom && <label className="qr-zoom-field"><span>Zoom <output>{zoom.toFixed(1)}×</output></span>
        <input aria-label="Kamera-Zoom" type="range" min={tools.zoom.min} max={tools.zoom.max} step={tools.zoom.step} value={zoom}
          onChange={event => void changeCamera({ zoom: Number(event.target.value) })} />
      </label>}
      {tools.torch && <button type="button" aria-pressed={torch} onClick={() => void changeCamera({ torch: !torch })}>{torch ? "Licht aus" : "Licht an"}</button>}
    </div>}
    <div className="qr-camera-controls">
      {!active && !starting ? <button type="button" className="primary-button" autoFocus disabled={disabled || readingImage} onClick={() => void start()}>Kamera starten</button>
        : <button type="button" onClick={stop}>{starting ? "Kamerastart abbrechen" : "Kamera stoppen"}</button>}
      <label className={`qr-file-button${disabled || readingImage || starting ? " is-disabled" : ""}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m21 15-5-5-7 8-3-3-3 3" />
        </svg>
        {readingImage ? "Bild wird gelesen …" : "Bild öffnen"}
        <input type="file" accept="image/*" aria-label="Code-Bild öffnen" disabled={disabled || readingImage || starting}
          onChange={event => void readImage(event.currentTarget)} />
      </label>
    </div>
    {devices.length > 1 && <label className="qr-device-field">Kamera
      <select aria-label="Kamera auswählen" disabled={disabled || readingImage} value={deviceId}
        onChange={event => { stop(); setDeviceId(event.target.value); }}>
        <option value="">Automatisch / Rückkamera</option>
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Kamera ${index + 1}`}</option>)}
      </select>
    </label>}
    {error && <p className="qr-error" role="alert">{error}</p>}
  </section>;
}
