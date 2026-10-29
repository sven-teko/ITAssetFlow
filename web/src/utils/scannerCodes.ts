export type CodeType = "auto" | "qr" | "ean";

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
