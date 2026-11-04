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

export function priceRange(input: string) {
  const value = input.trim();
  if (!value) return { from: null, to: null, error: "" };
  try {
    // Ein Schweizer Preis wie «10.-» enthält keinen Bereichstrenner.
    const [start, end, ...extra] = value.split(/(?<![.,])[-–—]/).map(part => part.trim());
    if (extra.length || (!start && !end)) throw new Error();
    const from = start ? parseCHF(start) : null;
    const to = end === undefined ? from : end ? parseCHF(end) : null;
    if (from !== null && to !== null && from > to) {
      return { from: null, to: null, error: "Der erste Preis darf nicht höher sein als der zweite." };
    }
    return { from, to, error: "" };
  } catch {
    return { from: null, to: null, error: "Bitte einen Preis wie 10 oder einen Bereich wie 10–100 eingeben." };
  }
}
