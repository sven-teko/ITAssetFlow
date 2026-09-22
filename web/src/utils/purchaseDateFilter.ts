export type PurchaseDateCriteria = {
  from: string;
  to: string;
};

// Kalendertage ohne Zeitzonenverschiebung vergleichen.
function calendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]
    ? `${year}-${month}-${day}` : null;
}

export function purchaseDateError(filter: PurchaseDateCriteria): string {
  if (filter.from && filter.to && filter.from > filter.to) {
    return "Das Von-Datum darf nicht nach dem Bis-Datum liegen.";
  }
  return "";
}

export function matchesPurchaseDate(value: unknown, filter: PurchaseDateCriteria): boolean {
  if (purchaseDateError(filter)) return false;
  if (!filter.from && !filter.to) return true;
  const date = calendarDate(value);
  if (!date) return false;
  return (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to);
}
