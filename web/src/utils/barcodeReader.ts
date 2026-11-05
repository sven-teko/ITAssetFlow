import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import type { CodeType } from "./scannerCodes";
import { barcodeFormats, identifierType, labelledCodes } from "./scannerCodes";

export type ScannedCode = { text: string; type: CodeType; format: string; labelled?: boolean };
type Source = HTMLVideoElement | HTMLImageElement;
type Rect = { x: number; y: number; width: number; height: number };

const options: ReaderOptions = {
  formats: ["QRCode", "EAN8", "EAN13", "UPCA", "Code128", "Code39", "Code93", "ITF", "Codabar", "DataMatrix", "PDF417", "Aztec"],
  tryHarder: true, tryRotate: true, tryInvert: true,
  returnErrors: false, maxNumberOfSymbols: 8, minLineCount: 2,
};
const overrides = { locateFile: (path: string, prefix: string) => path.endsWith(".wasm") ? wasmUrl : prefix + path };
let ready: Promise<unknown> | undefined;
const crop = (rect: Rect, x: number, y: number, w: number, h: number): Rect => ({
  x: rect.x + rect.width * x, y: rect.y + rect.height * y, width: rect.width * w, height: rect.height * h,
});

function improveContrast(image: ImageData) {
  const pixels = image.data;
  let low = 255, high = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = (77 * pixels[i] + 150 * pixels[i + 1] + 29 * pixels[i + 2]) >> 8;
    pixels[i] = gray;
    low = Math.min(low, gray); high = Math.max(high, gray);
  }
  const factor = 255 / Math.max(high - low, 12);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = (pixels[i] - low) * factor;
  }
}

export async function createBarcodeReader() {
  ready ??= prepareZXingModule({ overrides, fireImmediately: true }).catch(error => { ready = undefined; throw error; });
  await ready;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Die Bildverarbeitung ist in diesem Browser nicht verfügbar.");

  return async (source: Source, frame?: HTMLElement): Promise<ScannedCode[]> => {
    const video = source instanceof HTMLVideoElement;
    const width = video ? source.videoWidth : source.naturalWidth;
    const height = video ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return [];
    let target: Rect | undefined;
    let region: Rect = { x: 0, y: 0, width, height };
    if (frame) {
      const preview = source.getBoundingClientRect();
      const bounds = frame.getBoundingClientRect();
      if (!preview.width || !preview.height || !bounds.width || !bounds.height) return [];
      const aspect = preview.width / preview.height;
      const visibleWidth = Math.min(width, height * aspect), visibleHeight = Math.min(height, width / aspect);
      const visible = { x: (width - visibleWidth) / 2, y: (height - visibleHeight) / 2, width: visibleWidth, height: visibleHeight };
      const left = Math.max(preview.left, bounds.left);
      const top = Math.max(preview.top, bounds.top);
      target = crop(visible, (left - preview.left) / preview.width, (top - preview.top) / preview.height,
        (Math.min(preview.right, bounds.right) - left) / preview.width,
        (Math.min(preview.bottom, bounds.bottom) - top) / preview.height);
      // Include the quiet zone around long barcodes; filter decoded positions against the actual frame.
      const marginX = target.width * 0.12, marginY = target.height * 0.08;
      const x = Math.max(visible.x, target.x - marginX), y = Math.max(visible.y, target.y - marginY);
      region = { x, y, width: Math.min(visible.x + visible.width, target.x + target.width + marginX) - x,
        height: Math.min(visible.y + visible.height, target.y + target.height + marginY) - y };
    }
    if (region.width < 2 || region.height < 2) return [];
    const codes = new Map<string, { code: ScannedCode; distance: number }>();

    async function readRegion(rect: Rect, recover = false) {
      const scale = Math.min(recover ? 2 : 1, (video ? 1600 : 2200) / Math.max(rect.width, rect.height));
      const w = Math.round(rect.width * scale), h = Math.round(rect.height * scale);
      if (w < 2 || h < 2) return;
      const pad = 12;
      canvas.width = w + 2 * pad;
      canvas.height = h + 2 * pad;
      context!.fillStyle = "#fff";
      context!.fillRect(0, 0, canvas.width, canvas.height);
      context!.drawImage(source, rect.x, rect.y, rect.width, rect.height, pad, pad, w, h);
      if (recover) {
        const content = context!.getImageData(pad, pad, w, h);
        improveContrast(content);
        context!.putImageData(content, pad, pad);
      }
      const pixels = context!.getImageData(0, 0, canvas.width, canvas.height);
      const results = await readBarcodes(pixels, recover ? { ...options, minLineCount: 1, tryDenoise: true } : options);
      for (const result of results) {
        if (!result.isValid || result.error || !result.text) continue;
        let distance = 0;
        if (target) {
          const points = Object.values(result.position).map(point => ({
            x: (rect.x + (point.x - pad) * rect.width / w - target!.x) / target!.width,
            y: (rect.y + (point.y - pad) * rect.height / h - target!.y) / target!.height,
          }));
          const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
          const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
          if (x < 0 || x > 1 || y < 0 || y > 1 ||
            points.some(point => point.x < -0.06 || point.x > 1.06 || point.y < -0.06 || point.y > 1.06)) continue;
          distance = (x - 0.5) ** 2 + (y - 0.5) ** 2;
        }
        const paddedUpc = result.format === "EAN13" && /^0[0-9]{12}$/.test(result.text);
        const text = paddedUpc ? result.text.slice(1) : result.text;
        const format = paddedUpc ? "UPC-A" : barcodeFormats[result.format] ?? barcodeFormats[result.symbology];
        if (!format) continue;
        const fields = format === "UPC-A" || format.startsWith("EAN-") ? [] : labelledCodes(text);
        const decoded = fields.length ? fields.map(field => ({ ...field, format, labelled: true }))
          : [{ text, type: identifierType(text, format), format }];
        for (const code of decoded) {
          const key = JSON.stringify([code.type, code.text]);
          if (!codes.has(key) || distance < codes.get(key)!.distance) codes.set(key, { code, distance });
        }
      }
    }

    await readRegion(region);
    if (!codes.size || !video) await readRegion(region, true);
    const tradeCount = [...codes.values()].filter(({ code }) => code.type === "ean" || code.type === "upc").length;
    if (!video || tradeCount === 1) {
      // Overlapping crops can separate two nearby symbols or recover small codes in a large photo.
      const zones = [[0, 0, .68, 1], [.32, 0, .68, 1], [0, .32, 1, .68]];
      if (!video) zones.push([0, 0, 1, .68], [0, 0, .68, .68], [.32, .32, .68, .68]);
      for (const [x, y, w, h] of zones) {
        await readRegion(crop(region, x, y, w, h), !video);
        if (video && [...codes.values()].filter(({ code }) => code.type === "ean" || code.type === "upc").length > 1) break;
      }
    }
    return [...codes.values()].sort((a, b) => a.distance - b.distance).slice(0, 8).map(({ code }) => code);
  };
}
