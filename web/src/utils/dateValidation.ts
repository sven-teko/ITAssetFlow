/** Prüft ein Kalenderdatum, ohne Zeitzonenverschiebung oder Date-Rollover. */
export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function inventoryDateErrors(purchase: string, warranty = ""): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isValidISODate(purchase)) {
    errors.purchase_date = "Kaufdatum: Bitte ein gültiges Datum mit vierstelliger Jahreszahl eingeben.";
  }
  if (warranty && !isValidISODate(warranty)) {
    errors.warranty_until = "Garantie bis: Bitte ein gültiges Datum mit vierstelliger Jahreszahl eingeben.";
  } else if (warranty && !errors.purchase_date && warranty < purchase) {
    errors.warranty_until = "Garantie bis darf nicht vor dem Kaufdatum liegen.";
  }
  return errors;
}
