import { useEffect, useState } from "react";
import { API_BASE } from "../api/config";
import "./ItemImage.css";
export default function ItemImagePicker({ existingId, value, disabled, onChange, onBusy }: {
  existingId: string; value: Blob | null | undefined; disabled: boolean;
  onChange: (value: Blob | null) => void; onBusy: (busy: boolean) => void;
}) {
  const [preview,setPreview]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    return ()=> { if (preview) URL.revokeObjectURL(preview); };
  },[preview]);
  const source=value ? preview : value === null ? "" : existingId ? `${API_BASE}/api/images/${encodeURIComponent(existingId)}` : "";
  async function prepare(file?: File) {
    if (!file) return;
    setError("");setBusy(true);onBusy(true);
    try {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>15*1024*1024) throw new Error("Bitte ein JPG-, PNG- oder WebP-Bild bis 15 MB auswählen.");
      const bitmap=await createImageBitmap(file);
      try {
        const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext('2d');if (!context) throw new Error("Das Bild konnte nicht verarbeitet werden.");
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const image=await new Promise<Blob | null>(resolve=>canvas.toBlob(resolve,'image/webp',0.8));
        if (!image || image.type!=='image/webp' || image.size>1048576) throw new Error("Das Bild ist zu gross. Bitte ein kleineres Bild auswählen.");
        setPreview(URL.createObjectURL(image));onChange(image);
      } finally { bitmap.close(); }
    } catch(cause){setError(cause instanceof Error?cause.message:"Das Bild konnte nicht geöffnet werden.");}
    finally{setBusy(false);onBusy(false);}
  }
  return <fieldset className="asset-form-group item-image-picker"><legend>Artikelbild (optional)</legend>
    {source && <img src={source} alt="Vorschau des Artikelbilds"/>}
    <label>Bild auswählen<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled||busy}
      onChange={event=>{void prepare(event.target.files?.[0]);event.target.value='';}}/></label>
    {source && <button type="button" disabled={disabled||busy} onClick={()=>onChange(null)}>Bild entfernen</button>}
    {busy && <p role="status">Bild wird vorbereitet …</p>}{error && <p role="alert" className="archive-error">{error}</p>}
  </fieldset>;
}
