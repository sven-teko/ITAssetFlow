export type CodeType = "auto" | "qr" | "ean" | "mac" | "serial";

export function normalizeMac(value: string): string | null {
  const text = value.trim().replace(/^MAC(?:[- ]?(?:Adresse|Address))?\s*[:=]\s*/i, "");
  if (!/^(?:[a-f\d]{12}|(?:[a-f\d]{2}:){5}[a-f\d]{2}|(?:[a-f\d]{2}-){5}[a-f\d]{2}|(?:[a-f\d]{4}\.){2}[a-f\d]{4})$/i.test(text)) return null;
  return text.replace(/[:.-]/g, "").toUpperCase().match(/.{2}/g)!.join(":");
}

export function identifierType(value: string, format = ""): CodeType {
  if (format === "QR-Code") return "qr";
  if (format === "EAN-8" || format === "EAN-13") return "ean";
  if (normalizeMac(value)) return "mac";
  if (!format && isValidEan(value)) return "ean";
  return "serial";
}

export function isValidEan(value: string): boolean {
  if (!/^(?:[0-9]{8}|[0-9]{13})$/.test(value)) return false;
  const sum = [...value.slice(0, -1)].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(value.at(-1));
}

export function validateCodes(qr: string, ean: string): void {
  if (qr.trim().length > 100 || [...qr].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error("Der QR-Code darf höchstens 100 Zeichen und keine Steuerzeichen enthalten.");
  }
  if (ean.trim() && !isValidEan(ean.trim())) throw new Error("Bitte eine gültige EAN mit 8 oder 13 Ziffern und korrekter Prüfziffer eingeben.");
}
