import type { ScannedCode } from "./barcodeReader";

const isTradeCode = (code: ScannedCode) => code.type === "ean" || code.type === "upc";

// Confirm each code across frames, even when neighbouring codes appear and disappear.
export function createScanObservations() {
  const observed = new Map<string, { code: ScannedCode; first: number; last: number; count: number }>();
  return (codes: ScannedCode[], now: number): ScannedCode[] => {
    for (const [key, item] of observed) if (now - item.last > 1_000) observed.delete(key);
    for (const code of codes) {
      const key = JSON.stringify([code.type, code.text]);
      const item = observed.get(key);
      if (item) { item.last = now; item.count++; }
      else observed.set(key, { code, first: now, last: now, count: 1 });
    }
    const confirmed = [...observed.values()].filter(item => item.count >= 2);
    if (!confirmed.length) return [];
    const tradeCount = confirmed.filter(item => isTradeCode(item.code)).length;
    const age = now - Math.min(...confirmed.map(item => item.first));
    const foundRecently = confirmed.some(item => item.last === now);
    if (!foundRecently || age < (tradeCount === 1 ? 1_200 : 480)) return [];
    return confirmed.filter(item => now - item.last <= 800).slice(0, 8).map(item => item.code);
  };
}
