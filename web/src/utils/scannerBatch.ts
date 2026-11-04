import { lookupQr, type QrLookup, type QrMatch } from "../api/qrApi";
import type { ScannedCode } from "./barcodeReader";
import { normalizeMac, validateCodes, type ScanDraft, type ScanRole } from "./scannerCodes";

export type Assignment = ScanRole | "ignore";
export const scanLabels: Record<Assignment, string> = {
  ean: "EAN (Produktmodell)", upc: "UPC-A (Produktmodell)", serial: "Seriennummer",
  mac: "MAC-Adresse / MAC ID", qr: "QR-Code / Barcode", ignore: "Ignorieren",
};

export function proposeAssignments(codes: ScannedCode[]): Assignment[] {
  const plainSerials = codes.filter(code => code.type === "serial" && !code.labelled
    && !/^(?:IPUI|IPEI|SAP|P\/N)\s*[:=]/i.test(code.text));
  const hasLabelledSerial = codes.some(code => code.type === "serial" && code.labelled);
  return codes.map(code => {
    if (code.type === "auto" || /^(?:IPUI|IPEI|SAP|P\/N)\s*[:=]/i.test(code.text)) return "ignore";
    if (code.type === "serial" && !code.labelled && (plainSerials.length > 1 || hasLabelledSerial)) return "ignore";
    if (code.type === "qr" && /^https?:\/\//i.test(code.text)) return "ignore";
    return code.type;
  });
}

export function assignedCodes(codes: ScannedCode[], assignments: Assignment[]): ScanDraft {
  const draft: ScanDraft = {};
  for (const [index, code] of codes.entries()) {
    const role = assignments[index];
    if (role === "ignore") continue;
    const value = role === "mac" ? normalizeMac(code.text) : code.text.trim();
    if (!value || value.length > 100 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
      throw new Error(role === "mac" ? "Bitte eine gültige MAC-Adresse auswählen." : "Eine Kennung ist ungültig.");
    }
    if (draft[role] && draft[role] !== value) throw new Error(`Bitte nur eine Kennung für «${scanLabels[role]}» auswählen.`);
    draft[role] = value;
  }
  validateCodes(draft.qr ?? "", draft.ean ?? "", draft.upc ?? "");
  if (!Object.keys(draft).length) throw new Error("Bitte mindestens einen Code zuordnen.");
  return draft;
}

const roles = ["serial", "mac", "qr", "ean", "upc"] as const;
const intersect = <T,>(left: Set<T>, right: Set<T>) => new Set([...left].filter(value => right.has(value)));

export async function resolveScannerBatch(draft: ScanDraft, signal: AbortSignal): Promise<{
  lookup: QrLookup; draft: ScanDraft; role: ScanRole;
}> {
  const pairs = await Promise.all(roles.flatMap(role => draft[role]
    ? [lookupQr(draft[role], signal, role).then(result => ({ role, result }))] : []));
  const primary = pairs[0];
  const retail = pairs.filter(({ role }) => role === "ean" || role === "upc");
  const models = new Map(pairs.flatMap(({result}) => (result.models ?? []).map(model => [model.id, model] as const)));
  let modelIds: Set<number> | undefined;
  for (const { role, result } of pairs) {
    if (role !== "ean" && role !== "upc" && role !== "qr") continue;
    const ids = new Set((result.models ?? []).map(model => model.id));
    if (!ids.size && (role === "ean" || role === "upc")) {
      for (const row of result.matches) ids.add(row.product_model_id);
    }
    if (ids.size) modelIds = modelIds ? intersect(modelIds, ids) : ids;
  }
  if (modelIds?.size === 0) throw new Error("Die gescannten Produktcodes gehören zu unterschiedlichen Modellen.");

  let deviceKeys: Set<string> | undefined;
  const devices = new Map<string, QrMatch>();
  for (const { role, result } of pairs) {
    if (role === "ean" || role === "upc") continue;
    const keys = new Set(result.direct_asset_keys ?? (role === "qr" ? [] :
      result.matches.filter(row => row.record_type === "asset").map(row => row.key)));
    if (keys.size) deviceKeys = deviceKeys ? intersect(deviceKeys, keys) : keys;
    for (const row of result.matches) if (keys.has(row.key)) devices.set(row.key, row);
  }
  if (deviceKeys) {
    const matches = [...deviceKeys].map(key => devices.get(key)).filter((row): row is QrMatch =>
      !!row && (!modelIds || modelIds.has(row.product_model_id))
      && (!draft.serial || !row.serial_number || draft.serial.toUpperCase() === row.serial_number.toUpperCase())
      && (!draft.mac || !row.mac_address || draft.mac === normalizeMac(row.mac_address)));
    if (!matches.length) throw new Error("Die gescannten Kennungen passen nicht zum selben Gerät oder Modell.");
    return { lookup: { ...primary.result, matches, preferred_key: null }, draft, role: primary.role };
  }
  if (modelIds && modelIds.size > 1) throw new Error("Mehrere Produktmodelle passen. Bitte die Produktcodes einzeln prüfen.");
  const modelId = modelIds?.values().next().value;
  const qrModels = pairs.find(({role}) => role === "qr")?.result.models;
  const hasDeviceCode = Boolean(draft.serial || draft.mac || (draft.qr && retail.length && !qrModels?.length));
  if (hasDeviceCode && modelId !== undefined && models.get(modelId)?.tracking_mode === "quantity") {
    throw new Error("Das erkannte Modell wird nur als Menge geführt. Für ein Einzelgerät muss das Modell Einzelartikel erlauben.");
  }
  // The model result can include other devices of the same model. A new
  // serial number or MAC address must never select one of those devices.
  const usable = retail.find(({result}) => result.matches.some(row => !modelIds || modelIds.has(row.product_model_id)))
    ?? retail[0] ?? primary;
  const matches = hasDeviceCode ? [] : usable.result.matches.filter(row => !modelIds || modelIds.has(row.product_model_id));
  return { lookup: { ...usable.result, matches }, draft: { ...draft, modelId }, role: usable.role };
}
