import { useState } from "react";
import { API_BASE } from "../api/config";
import "./ItemImage.css";
export default function ItemImage({ id }: { id: string }) {
  const [failed,setFailed]=useState(false);
  return <figure className="item-image">{failed ? <p>Das Artikelbild ist derzeit nicht verfügbar.</p> :
    <img src={`${API_BASE}/api/images/${encodeURIComponent(id)}`} alt="Artikelbild" loading="lazy" onError={()=>setFailed(true)}/>}</figure>;
}
