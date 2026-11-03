import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../api/config";
import type { ArchiveReason } from "../api/archiveApi";
import { newBookingId, type Withdrawal, type WithdrawalSubmission } from "../api/stockBooking";
import { QrRequestError } from "../api/qrApi";
import { normalizeMac } from "../utils/scannerCodes";
import ArchiveReasonFields from "./ArchiveReasonFields";
import "./StockWithdrawalDialog.css";

type Row = Record<string,unknown>;
type Source = {product_model_id:number;storage_location_id:number;condition:string;quantity:number;product_model_name:string};
type Destinations = { sites: Row[]; departments: Row[]; storage_locations: Row[] };
export default function StockWithdrawalDialog({source,amount, fixedAmount=false,destinationData,onCancel,onConfirm}: {
  source:Source;amount:number;fixedAmount?:boolean;destinationData?: Destinations;onCancel:()=>void;onConfirm:(data:WithdrawalSubmission)=>Promise<void>;
}) {
  const ref=useRef<HTMLDialogElement>(null);
  const frozen=useRef<WithdrawalSubmission | null>(null);
  const inFlight=useRef(false);
  const [quantity,setQuantity]=useState(amount),[action,setAction]=useState<"" | Withdrawal["action"]>("");
  const [reason,setReason]=useState<ArchiveReason>({reason:"customer",customer_name:null,destroyed:null,note:null});
  const [fetchedDestinations,setFetchedDestinations]=useState<Destinations | null>(null);
  const [destinationError,setDestinationError]=useState("");
  const [site,setSite]=useState(""),[department,setDepartment]=useState(""),[location,setLocation]=useState("");
  const [condition,setCondition]=useState("used"),[status,setStatus]=useState("in_use"),[note,setNote]=useState("");
  const emptyUnit=()=>({asset_tag:"",serial_number:"",mac_address:""});
  const [units,setUnits]=useState(()=>Array.from({length:Math.min(amount,100)},emptyUnit));
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
  const destinations = destinationData ?? fetchedDestinations;
  const { sites, departments, storage_locations: locations } = destinations ?? {sites:[],departments:[],storage_locations:[]};
  const loading = !destinations && !destinationError;
  useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close();},[]);
  useEffect(()=>{
    if(action!=="assets" || destinations || destinationError)return;
    const controller=new AbortController();
    void fetch(`${API_BASE}/api/inventory/form-data`,{credentials:"include",cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error("Die Zielstandorte konnten nicht geladen werden.");
      const data=await response.json();if(controller.signal.aborted)return;
      setFetchedDestinations({sites:data.sites??[],departments:data.departments??[],storage_locations:data.storage_locations??[]});
    }).catch(cause=>{if(!controller.signal.aborted)setDestinationError(cause instanceof Error?cause.message:"Die Standorte konnten nicht geladen werden.");});
    return()=>controller.abort();
  },[action,destinations,destinationError]);
  const locked=busy||uncertain;
  function changeQuantity(value:number){setQuantity(value);setUnits(old=>Array.from({length:Math.min(Math.max(value,0),100)},(_,i)=>old[i]??emptyUnit()));}
  async function submit(event:FormEvent){
    event.preventDefault();event.stopPropagation();if(inFlight.current)return;setError("");
    inFlight.current=true;
    try {
      if(!uncertain){
        if(!Number.isInteger(quantity)||quantity<1||quantity>source.quantity)throw new Error("Bitte eine verfügbare ganze Menge wählen.");
        if(!action)throw new Error("Bitte die Verwendung wählen.");
        if(action==="assets" && quantity>100)throw new Error("Bitte höchstens 100 Einzelartikel pro Buchung erfassen.");
        const cleanUnits=units.slice(0,quantity).map(unit=>{
          const mac=unit.mac_address.trim()?normalizeMac(unit.mac_address):null;
          if(unit.mac_address.trim()&&!mac)throw new Error("Bitte die MAC-Adressen prüfen.");
          return {asset_tag:unit.asset_tag.trim(),serial_number:unit.serial_number.trim()||null,mac_address:mac};
        });
        frozen.current={request_id:newBookingId(),quantity,expected_quantity:source.quantity,withdrawal:action==="archive"?
          {action,reason}:{action,target_location_id:Number(location),target_condition:condition,target_status:status,units:cleanUnits,note:note.trim()}};
      }
      if(!frozen.current)return;setBusy(true);
      await onConfirm(frozen.current);
    }catch(cause){
      const ambiguous=cause instanceof QrRequestError && (cause.status===0||cause.status>=500);
      setUncertain(ambiguous);
      setError(ambiguous?"Die Antwort fehlt. Bitte dieselbe Buchung erneut prüfen; sie wird dabei nicht doppelt gebucht.":cause instanceof Error?cause.message:"Die Entnahme konnte nicht gespeichert werden.");
    }finally{inFlight.current=false;setBusy(false);}
  }
  return createPortal(<dialog ref={ref} className="stock-withdrawal" aria-labelledby="withdrawal-title" onCancel={e=>{e.preventDefault();if(!locked)onCancel();}}>
    <form onSubmit={event=>void submit(event)}><header><h2 id="withdrawal-title">Bestand entnehmen</h2><p>{source.product_model_name} · {source.quantity} Stück verfügbar</p></header>
    <fieldset disabled={locked}><label>Menge entnehmen *<input aria-label="Menge entnehmen *" type="number" min={1} max={source.quantity} step={1} required readOnly={fixedAmount} value={quantity} onChange={e=>changeQuantity(Number(e.target.value))}/></label>
    <label>Verwendung *<select aria-label="Verwendung *" required value={action} onChange={e=>setAction(e.target.value as typeof action)}>
      <option value="">Bitte auswählen</option><option value="assets">Als Einzelartikel erfassen</option><option value="archive">Ins Archiv übernehmen</option>
    </select></label>
    {action==="archive" && <ArchiveReasonFields value={reason} onChange={setReason}/>}
    {action==="assets" && <>
      <p>Für jedes entnommene Stück entsteht ein eigener Artikel am gewählten Ziel.</p>
      {destinationError?<p role="alert" className="archive-error">{destinationError} <button type="button" onClick={()=>setDestinationError("")}>Erneut laden</button></p>:loading?<p role="status">Standorte werden geladen …</p>:<div className="withdrawal-target">
        <label>Standort *<select aria-label="Zielstandort *" required value={site} onChange={e=>{setSite(e.target.value);setDepartment("");setLocation("");}}><option value="">Bitte auswählen</option>{sites.map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>
        <label>Abteilung *<select aria-label="Zielabteilung *" required value={department} onChange={e=>{setDepartment(e.target.value);setLocation("");}}><option value="">Bitte auswählen</option>{departments.filter(row=>String(row.site_id)===site).map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>
        <label>Lagerort / Einsatzort *<select aria-label="Ziel-Lagerort *" required value={location} onChange={e=>setLocation(e.target.value)}><option value="">Bitte auswählen</option>{locations.filter(row=>String(row.site_id)===site&&String(row.department_id)===department&&row.is_active!==false).map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>
      </div>}
      <div className="withdrawal-target"><label>Zustand<select aria-label="Zustand der Einzelartikel" value={condition} onChange={e=>setCondition(e.target.value)}>{Object.entries({new:"Neu",like_new:"Neuwertig",used:"Gebraucht",worn:"Abgenutzt",defective:"Defekt"}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Status<select aria-label="Status der Einzelartikel" value={status} onChange={e=>setStatus(e.target.value)}>{Object.entries({in_use:"Im Einsatz",available:"Verfügbar",defective:"Defekt",in_repair:"In Reparatur"}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>
      {quantity>100?<p role="alert">Höchstens 100 Einzelartikel pro Buchung.</p>:units.slice(0,quantity).map((unit,i)=><section className="withdrawal-unit" key={i}><h3>Einzelartikel {i+1}</h3>{([['asset_tag','Produkterkennung *',50],['serial_number','Seriennummer',100],['mac_address','MAC-Adresse',50]] as const).map(([key,label,max])=><label key={key}>{label}<input aria-label={`${label} ${i+1}`} required={key==='asset_tag'} maxLength={max} value={unit[key]} onChange={e=>setUnits(old=>old.map((row,index)=>index===i?{...row,[key]:e.target.value}:row))}/></label>)}</section>)}
      <label>Bemerkung zu den Einzelartikeln<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
    </>}
    </fieldset>{error&&<p role="alert" className="archive-error">{error}</p>}
    <footer><button type="button" disabled={locked} onClick={onCancel}>Abbrechen</button><button type="submit" className="primary-button" disabled={busy||(action==="assets"&&!destinations)}>{busy?"Wird gebucht …":uncertain?"Buchung erneut prüfen":"Entnahme buchen"}</button></footer>
    </form></dialog>,document.body);
}
