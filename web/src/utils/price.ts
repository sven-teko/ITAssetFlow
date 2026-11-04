export function parseCHF(value: string): number {
  const normalized = value.trim().replace(/^CHF\s*/i, "")
    .replace(/[’'\s]/g, "").replace(/[.,]-$/, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || !Number.isSafeInteger(Math.round(Number(normalized) * 100))) {
    throw new Error("Bitte einen gültigen CHF-Betrag ab 0 mit maximal zwei Nachkommastellen eingeben.");
  }
  return Number(normalized);
}

export function formatCHF(value: number): string {
  const total = Math.round(value * 100);
  const whole = Math.trunc(total / 100).toLocaleString("en-US").replaceAll(",", "'");
  const cents = total % 100;
  return cents === 0 ? `CHF ${whole}.-` : `CHF ${whole}.${String(cents).padStart(2, "0")}`;
}

export type PriceRange = { from: string; to: string };

export function priceRange(range: PriceRange) {
  let from: number | null = null;
  let to: number | null = null;
  try {
    if (range.from.trim()) from = parseCHF(range.from);
    if (range.to.trim()) to = parseCHF(range.to);
  } catch {
    return { from, to, error: "Bitte gültige CHF-Beträge eingeben." };
  }
  return { from, to, error: from !== null && to !== null && from > to ? "«Von» darf nicht grösser sein als «Bis»." : "" };
}
