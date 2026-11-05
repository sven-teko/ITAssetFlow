export type CodeType = "auto" | "qr" | "ean" | "upc" | "mac" | "serial" | "asset_tag";
export type ScanRole = Exclude<CodeType, "auto">;
export type ScanDraft = Partial<Record<ScanRole, string>> & { modelId?: number };
export const barcodeFormats: Record<string, string> = {
  QRCode: "QR-Code", EAN8: "EAN-8", EAN13: "EAN-13", UPCA: "UPC-A",
  Code128: "Code 128", Code39: "Code 39", Code93: "Code 93", ITF: "ITF", Codabar: "Codabar",
  DataMatrix: "Data Matrix", PDF417: "PDF417", Aztec: "Aztec",
};

export function isSerialCandidate(code: { labelled?: boolean; type: CodeType; format: string; text: string }): boolean {
  const value = code.text.trim();
  if (!value || value.length > 100 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  if (code.labelled) return code.type === "serial";
  if (/^(?:IPUI|IPEI|SAP|P\/N|EAN(?:-8|-13)?|UPC(?:-A)?|MAC(?:[- ]?(?:Adresse|Address|ID))?)\s*[:=]/i.test(value)) return false;
  if (["QR-Code", "Data Matrix", "PDF417", "Aztec"].includes(code.format)) {
    return /^[a-z\d][a-z\d._:+/-]*$/i.test(value) && !value.includes("://");
  }
  return code.type === "serial" || code.type === "asset_tag" || code.type === "mac";
}

export function normalizeMac(value: string): string | null {
  const text = value.trim().replace(/^MAC(?:[- ]?(?:Adresse|Address))?\s*[:=]\s*/i, "");
  if (!/^(?:[a-f\d]{12}|(?:[a-f\d]{2}:){5}[a-f\d]{2}|(?:[a-f\d]{2}-){5}[a-f\d]{2}|(?:[a-f\d]{4}\.){2}[a-f\d]{4})$/i.test(text)) return null;
  return text.replace(/[:.-]/g, "").toUpperCase().match(/.{2}/g)!.join(":");
}

export function identifierType(value: string, format = ""): ScanRole {
  if (format === "QR-Code") return "qr";
  if (format === "EAN-8" || format === "EAN-13") return "ean";
  if (format === "UPC-A" || (!format && isValidUpc(value))) return "upc";
  if (normalizeMac(value)) return /^[a-f\d]{12}$/i.test(value.trim()) ? "asset_tag" : "mac";
  if (!format && isValidEan(value)) return "ean";
  return "serial";
}

export function isValidEan(value: string): boolean {
  return /^(?:[0-9]{8}|[0-9]{13})$/.test(value) && hasCheckDigit(value);
}

export function isValidUpc(value: string): boolean {
  return /^[0-9]{12}$/.test(value) && hasCheckDigit(value);
}

function hasCheckDigit(value: string): boolean {
  const sum = [...value.slice(0, -1)].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(value.at(-1));
}

export function validateCodes(qr: string, ean: string, upc = ""): void {
  if (qr.trim().length > 100 || [...qr].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error("Der QR-Code darf höchstens 100 Zeichen und keine Steuerzeichen enthalten.");
  }
  if (ean.trim() && !isValidEan(ean.trim())) throw new Error("Bitte eine gültige EAN mit 8 oder 13 Ziffern und korrekter Prüfziffer eingeben.");
  if (upc.trim() && !isValidUpc(upc.trim())) throw new Error("Bitte eine gültige UPC-A mit 12 Ziffern und korrekter Prüfziffer eingeben.");
}

// An ordinary Code 128/39 symbol does not encode the meaning of its content.
export function labelledCodes(value: string): { type: ScanRole; text: string }[] {
  const result: { type: ScanRole; text: string }[] = [];
  for (const part of value.split(/[\r\n;|]+/)) {
    const fieldText = part.trim();
    const assetTag = /^MAC[- ]?ID(?:\s*[:=]\s*|\s+)(\S.*)$/i.exec(fieldText);
    if (assetTag) {
      result.push({ type: "asset_tag", text: assetTag[1] });
      continue;
    }
    const field = /^(MAC(?:[- ]?(?:Adresse|Address))?|S\/?N|Serial(?:[ -]?(?:Number|No\.?))?|Seriennummer|EAN(?:-8|-13)?|UPC(?:-A)?)\s*[:=]\s*(.+)$/i.exec(fieldText);
    if (!field) continue;
    const key = field[1].toUpperCase(), text = field[2].trim();
    if (key.startsWith("MAC")) {
      const mac = normalizeMac(text);
      if (mac) result.push({ type: "mac", text: mac });
    } else if (key.startsWith("EAN")) {
      if (isValidEan(text)) result.push({ type: "ean", text });
    } else if (key.startsWith("UPC")) {
      if (isValidUpc(text)) result.push({ type: "upc", text });
    } else if (text.length <= 100) result.push({ type: "serial", text });
  }
  return result;
}
