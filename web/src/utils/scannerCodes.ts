export type CodeType = "auto" | "qr" | "ean" | "upc" | "mac" | "serial";
export type ScanRole = Exclude<CodeType, "auto">;
export type ScanDraft = Partial<Record<ScanRole, string>> & { modelId?: number };

export function normalizeMac(value: string): string | null {
  const text = value.trim().replace(/^MAC(?:[- ]?(?:Adresse|Address|ID))?\s*[:=]\s*/i, "");
  if (!/^(?:[a-f\d]{12}|(?:[a-f\d]{2}:){5}[a-f\d]{2}|(?:[a-f\d]{2}-){5}[a-f\d]{2}|(?:[a-f\d]{4}\.){2}[a-f\d]{4})$/i.test(text)) return null;
  return text.replace(/[:.-]/g, "").toUpperCase().match(/.{2}/g)!.join(":");
}

export function identifierType(value: string, format = ""): ScanRole {
  if (format === "QR-Code") return "qr";
  if (format === "EAN-8" || format === "EAN-13") return "ean";
  if (format === "UPC-A" || (!format && isValidUpc(value))) return "upc";
  if (normalizeMac(value)) return "mac";
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
    const field = /^(MAC(?:[- ]?(?:ID|Adresse|Address))?|S\/?N|Serial(?:[ -]?(?:Number|No\.?))?|Seriennummer|EAN(?:-8|-13)?|UPC(?:-A)?)\s*[:=]\s*(.+)$/i.exec(part.trim());
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
