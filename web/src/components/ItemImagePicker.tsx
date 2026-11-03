import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { API_BASE } from "../api/config";
import "./ItemImage.css";

const IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif";

async function decodePhoto(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // Some mobile browsers can display camera formats that ImageBitmap does not decode.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Dieses Bildformat kann der Browser nicht öffnen. Bitte ein JPG-, PNG- oder WebP-Bild verwenden."));
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export default function ItemImagePicker({ existingId, value, disabled, onChange, onBusy }: {
  existingId: string; value: Blob | null | undefined; disabled: boolean;
  onChange: (value: Blob | null) => void; onBusy: (busy: boolean) => void;
}) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const source = value ? preview : value === null ? "" : existingId ? `${API_BASE}/api/images/${encodeURIComponent(existingId)}` : "";

  async function prepare(file?: File) {
    if (!file) return;
    setError("");
    setBusy(true);
    onBusy(true);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("Das Artikelbild darf höchstens 15 MB gross sein.");
      if (file.type && !IMAGE_TYPES.split(",").includes(file.type)) {
        throw new Error("Bitte ein JPG-, PNG-, WebP- oder HEIC-Bild auswählen.");
      }
      const photo = await decodePhoto(file);
      try {
        const scale = Math.min(1, 1280 / Math.max(photo.width, photo.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(photo.width * scale));
        canvas.height = Math.max(1, Math.round(photo.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Das Bild konnte nicht verarbeitet werden.");
        context.drawImage(photo.source, 0, 0, canvas.width, canvas.height);
        const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.8));
        if (!image || image.type !== "image/webp" || image.size > 1048576) throw new Error("Das Bild konnte nicht als WebP bis 1 MB gespeichert werden.");
        setPreview(URL.createObjectURL(image));
        onChange(image);
      } finally { photo.dispose(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Bild konnte nicht geöffnet werden."); }
    finally { setBusy(false); onBusy(false); }
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    void prepare(event.currentTarget.files?.[0]);
    event.currentTarget.value = "";
  }

  return <fieldset className="asset-form-group item-image-picker"><legend>Artikelbild (optional)</legend>
    {source && <img src={source} alt="Vorschau des Artikelbilds"/>}
    <label>Bild auswählen<input type="file" accept={IMAGE_TYPES} disabled={disabled || busy} onChange={selectPhoto}/></label>
    <input ref={cameraInput} hidden type="file" aria-label="Kamerafoto" accept="image/*" capture="environment"
      disabled={disabled || busy} onChange={selectPhoto}/>
    <div className="item-image-actions">
      <button type="button" className="item-image-camera" disabled={disabled || busy} onClick={() => cameraInput.current?.click()}>Foto aufnehmen</button>
      {source && <button type="button" disabled={disabled || busy} onClick={() => { setPreview(""); onChange(null); }}>Bild entfernen</button>}
    </div>
    {busy && <p role="status">Bild wird vorbereitet …</p>}{error && <p role="alert" className="archive-error">{error}</p>}
  </fieldset>;
}
