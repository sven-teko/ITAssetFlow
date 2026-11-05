import { useEffect, useState } from "react";
import { loadQrDeviceDetails, type QrDeviceDetails as Details } from "../api/qrApi";
import { DEFAULT_INVENTORY_META } from "../utils/defaultInventoryMeta";
import ItemImage from "./ItemImage";

export default function QrDeviceDetails({ assetKey }: { assetKey: string }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    loadQrDeviceDetails(assetKey, controller.signal).then(data => {
      if (!controller.signal.aborted) setDetails(data);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Die Gerätedetails konnten nicht geladen werden.");
    });
    return () => controller.abort();
  }, [assetKey]);

  if (error) return <p className="qr-error" role="alert">{error}</p>;
  if (!details) return <p className="qr-hint" role="status">Gerätedetails werden geladen …</p>;

  const { condition_labels, status_labels } = DEFAULT_INVENTORY_META;
  const fields = [
    ["Seriennummer", details.serial_number || "Nicht erfasst"],
    ...(details.mac_address ? [["MAC-Adresse", details.mac_address]] : []),
    ["Zustand", details.condition ? condition_labels[details.condition] ?? details.condition : "Nicht erfasst"],
    ["Status", details.status ? status_labels[details.status] ?? details.status : "Nicht erfasst"],
    ["Hat Netzteil?", details.has_power_supply === true ? "Ja" : details.has_power_supply === false ? "Nein" : "Nicht erfasst"],
  ];

  return <div className="qr-device-details">
    <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {details.image_id && <ItemImage id={details.image_id} />}
  </div>;
}
