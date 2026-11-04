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

const intersect = <T,>(left: Set<T>, right: Set<T>) => new Set([...left].filter(value => right.has(value)));

export async function resolveScannerBatch(draft: ScanDraft, signal: AbortSignal): Promise<{
  lookup: QrLookup; draft: ScanDraft; role: ScanRole;
}> {
  const fetchRoles = (roles: ScanRole[]) => Promise.all(roles.flatMap(role => draft[role]
    ? [lookupQr(draft[role], signal, role).then(result => ({ role, result }))] : []));
  const retail = await fetchRoles(["ean", "upc"]);
  let modelIds: Set<number> | undefined;
  for (const { result } of retail) {
    const ids = new Set((result.models ?? []).map(model => model.id));
    if (!ids.size) {
      for (const row of result.matches) ids.add(row.product_model_id);
    }
    if (ids.size) modelIds = modelIds ? intersect(modelIds, ids) : ids;
  }
  if (modelIds?.size === 0) throw new Error("Die gescannten Produktcodes gehören zu unterschiedlichen Modellen.");
  if (modelIds?.size) {
    const matchedIds = modelIds;
    const modelId = matchedIds.size === 1 ? matchedIds.values().next().value : undefined;
    const usable = retail.find(({result}) => result.matches.some(row => matchedIds.has(row.product_model_id)))
      ?? retail.find(({result}) => result.models?.some(model => matchedIds.has(model.id))) ?? retail[0];
    const rows = new Map<string, QrMatch>();
    for (const {result} of retail) {
      for (const row of result.matches) if (matchedIds.has(row.product_model_id)) rows.set(row.key, row);
    }
    // A retail code identifies a model, so even an unregistered SN must not
    // hide its other devices or open the create form instead.
    const matches = [...rows.values()];
    if (!matches.length && modelId === undefined) {
      throw new Error("Mehrere Produktmodelle passen. Bitte die Produktcodes einzeln prüfen.");
    }
    return {
      lookup: { ...usable.result, matches, preferred_key: matches.length === 1 ? matches[0].key : null },
      draft: { ...draft, modelId }, role: usable.role,
    };
  }

  const pairs = await fetchRoles(["serial", "mac", "qr"]);
  const primary = pairs[0] ?? retail[0];
  let deviceKeys: Set<string> | undefined;
  const devices = new Map<string, QrMatch>();
  for (const { role, result } of pairs) {
    const keys = new Set(result.direct_asset_keys ?? (role === "qr" ? [] :
      result.matches.filter(row => row.record_type === "asset").map(row => row.key)));
    if (keys.size) deviceKeys = deviceKeys ? intersect(deviceKeys, keys) : keys;
    for (const row of result.matches) if (keys.has(row.key)) devices.set(row.key, row);
  }
  if (deviceKeys) {
    const matches = [...deviceKeys].map(key => devices.get(key)).filter((row): row is QrMatch =>
      !!row
      && (!draft.serial || !row.serial_number || draft.serial.toUpperCase() === row.serial_number.toUpperCase())
      && (!draft.mac || !row.mac_address || draft.mac === normalizeMac(row.mac_address)));
    if (!matches.length) throw new Error("Die gescannten Kennungen passen nicht zum selben Gerät oder Modell.");
    const hit = pairs.find(({result}) => matches.some(row =>
      result.direct_asset_keys?.includes(row.key) ?? result.matches.some(match => match.key === row.key),
    )) ?? primary;
    return { lookup: { ...hit.result, matches, preferred_key: null }, draft, role: hit.role };
  }
  const qr = pairs.find(({role}) => role === "qr");
  if (qr?.result.matches.length && !draft.serial && !draft.mac) {
    return { lookup: qr.result, draft, role: "qr" };
  }
  return { lookup: { ...primary.result, matches: [], preferred_key: null }, draft, role: primary.role };
}
