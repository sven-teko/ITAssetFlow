export function parseCHF(value: string): number {
  const text = value.trim().replace(/^CHF\s*/i, "").replace(/’/g, "'").replace(/[\u00a0\u202f]/g, " ");
  const valid = /^(?:\d+|\d{1,3}([' ])\d{3}(?:\1\d{3})*)(?:[.,](?:\d{1,2}|-))?$/.test(text);
  const amount = Number(text.replace(/[' ]/g, "").replace(/[.,]-$/, "").replace(",", "."));
  if (!valid || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error("Bitte einen CHF-Betrag wie 12.50 oder 1’250.00 eingeben.");
  }
  return amount;
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
