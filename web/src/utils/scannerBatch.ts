import { lookupQr, type QrLookup, type QrMatch } from "../api/qrApi";
import type { ScannedCode } from "./barcodeReader";
import { normalizeMac, validateCodes, type ScanDraft, type ScanRole } from "./scannerCodes";

export type Assignment = ScanRole | "ignore";
export const scanLabels: Record<Assignment, string> = {
  ean: "EAN (Produktmodell)", upc: "UPC-A (Produktmodell)", serial: "Seriennummer",
  mac: "MAC-Adresse", asset_tag: "Produkterkennung (MAC-ID)", qr: "QR-Code / Barcode", ignore: "Ignorieren",
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
    if (role === "asset_tag" && value && value.length > 50) throw new Error("Die Produkterkennung darf höchstens 50 Zeichen enthalten.");
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
type Probe = { role: ScanRole; text: string; format?: string; labelled?: boolean };
type Hit = Probe & { result: QrLookup };
const isRetail = (role: ScanRole) => role === "ean" || role === "upc";

function directMatches(hit: Hit): QrMatch[] {
  const { result, role } = hit;
  const direct = new Set(result.direct_asset_keys ?? (role === "qr" || isRetail(role) ? [] :
    result.matches.filter(row => row.record_type === "asset").map(row => row.key)));
  return result.matches.filter(row => row.record_type === "asset" && direct.has(row.key)
    && (role !== "serial" || !hit.labelled || row.serial_number === hit.text));
}

async function resolveProbes(probes: Probe[], signal: AbortSignal) {
  const hasEan = probes.some(probe => probe.role === "ean");
  const distinct = new Map<string, Probe>();
  for (const probe of probes) {
    const key = JSON.stringify([probe.role, probe.text]);
    if (!distinct.has(key) || probe.labelled) distinct.set(key, probe);
  }
  const hits = await Promise.all([...distinct.values()].map(async probe => {
    const type = probe.role === "asset_tag" && !probe.labelled ? "auto" : probe.role;
    return { ...probe, result: await lookupQr(probe.text, signal, type, hasEan && probe.role === "asset_tag") };
  }));
  const exact = hits.map(hit => ({ hit, rows: directMatches(hit) })).filter(entry => entry.rows.length);
  const retail = hits.filter(hit => isRetail(hit.role) && !directMatches(hit).length);
  let modelIds: Set<number> | undefined;
  for (const { result } of retail) {
    const ids = new Set((result.models ?? []).map(model => model.id));
    if (!ids.size) for (const row of result.matches) ids.add(row.product_model_id);
    if (ids.size) modelIds = modelIds ? intersect(modelIds, ids) : ids;
  }
  if (modelIds?.size === 0) throw new Error("Die gescannten Produktcodes gehören zu unterschiedlichen Modellen.");

  if (exact.length) {
    let keys = new Set(exact[0].rows.map(row => row.key));
    for (const { rows } of exact.slice(1)) keys = intersect(keys, new Set(rows.map(row => row.key)));
    if (!keys.size) throw new Error("Die gescannten Kennungen passen nicht zum selben Gerät.");
    const primary = exact[0].hit;
    const matches = exact[0].rows.filter(row => keys.has(row.key) && (!modelIds || modelIds.has(row.product_model_id)));
    if (!matches.length) throw new Error("Die gescannte Gerätekennung gehört zu einem anderen Produktmodell als die EAN oder UPC.");
    return { primary, lookup: { ...primary.result, matches, models: [],
      device_match_keys: matches.map(row => row.key), preferred_key: matches.length === 1 ? matches[0].key : null,
    } };
  }

  if (modelIds?.size) {
    const ids = modelIds;
    const modelId = ids.size === 1 ? ids.values().next().value : undefined;
    const primary = retail.find(({ result }) => result.matches.some(row => ids.has(row.product_model_id)))
      ?? retail.find(({ result }) => result.models?.some(model => ids.has(model.id))) ?? retail[0];
    const rows = new Map<string, QrMatch>();
    for (const { result } of retail) {
      for (const row of result.matches) if (ids.has(row.product_model_id)) rows.set(row.key, row);
    }
    const matches = [...rows.values()];
    if (!matches.length && modelId === undefined) {
      throw new Error("Mehrere Produktmodelle passen. Bitte die Produktcodes einzeln prüfen.");
    }
    return { primary, modelId, lookup: { ...primary.result, matches, preferred_key: matches.length === 1 ? matches[0].key : null } };
  }

  const shared = hits.filter(({ role, result }) => (role === "qr" || role === "serial") && result.matches.length
    && (result.models?.length || result.matches.every(row => row.record_type === "stock")));
  if (shared.length === 1) return { primary: shared[0], lookup: shared[0].result };
  return { primary: hits[0], lookup: { ...hits[0].result, matches: [], preferred_key: null } };
}

export async function resolveScannerBatch(draft: ScanDraft, signal: AbortSignal): Promise<{
  lookup: QrLookup; draft: ScanDraft; role: ScanRole;
}> {
  const roles: ScanRole[] = ["asset_tag", "serial", "mac", "qr", "ean", "upc"];
  const probes = roles.flatMap(role => draft[role] ? [{ role, text: draft[role], labelled: true }] : []);
  const { primary, lookup, modelId } = await resolveProbes(probes, signal);
  const newModel = !!(draft.asset_tag && draft.ean && modelId === undefined && !lookup.matches.length);
  return { lookup, draft: { ...draft, modelId, newModel }, role: primary.role };
}

// Look up each physical symbol before suggesting roles. An unrecognised
// second Code 128 symbol (often P/N) must not hide a registered S/N.
export async function resolveScannerCandidates(codes: ScannedCode[], signal: AbortSignal) {
  const probes = codes.flatMap(({ type, text, format, labelled }): Probe[] =>
    type === "auto" || !text.trim() || text.length > 100
      || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || /^(?:IPUI|IPEI|SAP|P\/N)\s*[:=]/i.test(text) || /^https?:\/\//i.test(text)
      ? [] : [{ role: type, text: text.trim(), format, labelled }]);
  if (!probes.length) return;
  const result = await resolveProbes(probes, signal);
  const tags = [...new Set(probes.filter(probe => probe.role === "asset_tag" && probe.text.length <= 50).map(probe => probe.text))];
  const eans = [...new Set(probes.filter(probe => probe.role === "ean").map(probe => probe.text))];
  const draft: ScanDraft | undefined = tags.length === 1 && eans.length === 1
    ? { asset_tag: tags[0], ean: eans[0], modelId: result.modelId,
        newModel: result.modelId === undefined && !result.lookup.matches.length }
    : undefined;
  return { ...result, draft };
}
