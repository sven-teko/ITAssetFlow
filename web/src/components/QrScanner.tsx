import { useCallback, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

type Props = { onCode: (code: string) => void; disabled: boolean };

function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Kamerazugriff nicht erlaubt. Bitte die Kameraberechtigung für diese Webseite im Browser freigeben.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Keine Kamera gefunden. Du kannst stattdessen ein QR-Bild öffnen oder die Kennung eingeben.";
  if (name === "NotReadableError") return "Die Kamera ist belegt oder konnte nicht gestartet werden. Bitte andere Kamera-Anwendungen schliessen.";
  return "Die Kamera konnte nicht gestartet werden. Bitte HTTPS, Kameraberechtigung und Kamera prüfen.";
}

export default function QrScanner({ onCode, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const generation = useRef(0);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState("");

  const release = useCallback(() => {
    generation.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => { release(); setActive(false); setStarting(false); }, [release]);

  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); release(); };
  }, [release, stop]);

  async function start() {
    stop();
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Für den Kamerazugriff ist eine vertrauenswürdige HTTPS-Verbindung erforderlich. Alternativ QR-Bild öffnen oder Kennung eingeben.");
      return;
    }
    const run = generation.current;
    setStarting(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (run !== generation.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (run !== generation.current || !videoRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      setActive(true);
      setStarting(false);
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 500 });
      const controls = await reader.decodeFromStream(stream, videoRef.current, (result, _error, scanner) => {
        if (!result || run !== generation.current) return;
        scanner.stop();
        stop();
        onCode(result.getText());
      });
      if (run !== generation.current) { controls.stop(); return; }
      controlsRef.current = controls;
      // Manche Browser erlauben die Aufnahme, aber keine Geräteauflistung.
      const cameras = (await navigator.mediaDevices.enumerateDevices().catch(() => []))
        .filter((device) => device.kind === "videoinput");
      if (run === generation.current) setDevices(cameras);
    } catch (cause) {
      if (run !== generation.current) return;
      stop();
      setError(cameraError(cause));
    }
  }

  async function readImage(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    stop();
    setError("");
    if (file.size > 15 * 1024 * 1024) { setError("Bitte ein Bild unter 15 MB auswählen."); input.value = ""; return; }
    const run = generation.current;
    const url = URL.createObjectURL(file);
    setReadingImage(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      if (run === generation.current) onCode(result.getText());
    } catch {
      if (run === generation.current) setError("Kein lesbarer QR-Code im Bild gefunden. Bitte den vollständigen Code scharf und gut beleuchtet aufnehmen.");
    } finally {
      URL.revokeObjectURL(url);
      input.value = "";
      if (run === generation.current) setReadingImage(false);
    }
  }

  return <section className="qr-camera" aria-label="QR-Scanner">
    <div className="qr-camera-controls">
      {!active && !starting ? <button type="button" className="primary-button" disabled={disabled || readingImage} onClick={() => void start()}>Kamera starten</button>
        : <button type="button" onClick={stop}>{starting ? "Kamerastart abbrechen" : "Kamera stoppen"}</button>}
      <label className="qr-file-button">{readingImage ? "Bild wird gelesen …" : "QR-Bild öffnen"}
        <input type="file" accept="image/*" capture="environment" aria-label="QR-Bild öffnen" disabled={disabled || readingImage || starting}
          onChange={(event) => void readImage(event.currentTarget)} />
      </label>
      {devices.length > 1 && <select aria-label="Kamera auswählen" disabled={disabled || readingImage}
        value={deviceId} onChange={(event) => { stop(); setDeviceId(event.target.value); }}>
        <option value="">Automatisch / Rückkamera</option>
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Kamera ${index + 1}`}</option>)}
      </select>}
    </div>
    <div className={`qr-video-wrap${active ? " active" : ""}`}>
      <video ref={videoRef} muted playsInline autoPlay aria-label="Kamerabild für QR-Code" />
      {active && <span className="qr-scan-frame" aria-hidden="true" />}
    </div>
    {active && <p className="qr-hint">QR-Code vollständig in den Rahmen halten.</p>}
    {error && <p className="qr-error" role="alert">{error}</p>}
  </section>;
}
