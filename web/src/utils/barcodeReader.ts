import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import type { CodeType } from "./scannerCodes";
import { identifierType, labelledCodes } from "./scannerCodes";

export type ScannedCode = { text: string; type: CodeType; format: string; labelled?: boolean };
type Source = HTMLVideoElement | HTMLImageElement;

const options: ReaderOptions = {
  formats: ["QRCode", "EAN8", "EAN13", "UPCA", "Code128", "Code39"],
  tryHarder: true, tryRotate: true, tryInvert: true,
  returnErrors: false, maxNumberOfSymbols: 1, minLineCount: 2,
};
// Bundle the matching binary with the application; scanning needs no CDN.
const overrides = { locateFile: (path: string, prefix: string) => path.endsWith(".wasm") ? wasmUrl : prefix + path };
let ready: Promise<unknown> | undefined;

export async function createBarcodeReader() {
  ready ??= prepareZXingModule({ overrides, fireImmediately: true }).catch(error => { ready = undefined; throw error; });
  await ready;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Die Bildverarbeitung ist in diesem Browser nicht verfügbar.");

  return async (source: Source, enhance = false, frame?: HTMLElement): Promise<ScannedCode[]> => {
    const video = source instanceof HTMLVideoElement;
    const width = video ? source.videoWidth : source.naturalWidth;
    const height = video ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return [];
    const aspect = video && source.clientHeight ? source.clientWidth / source.clientHeight : width / height;
    // Map the visible overlay back to the centre-cropped object-fit video.
    const visibleWidth = Math.min(width, height * aspect), visibleHeight = Math.min(height, width / aspect);
    let region = { x: (width - visibleWidth) / 2, y: (height - visibleHeight) / 2, width: visibleWidth, height: visibleHeight };
    if (frame) {
      const preview = source.getBoundingClientRect();
      const target = frame.getBoundingClientRect();
      if (!preview.width || !preview.height || !target.width || !target.height) return [];
      const left = Math.max(preview.left, target.left);
      const top = Math.max(preview.top, target.top);
      const scaleX = visibleWidth / preview.width, scaleY = visibleHeight / preview.height;
      region = {
        x: region.x + (left - preview.left) * scaleX,
        y: region.y + (top - preview.top) * scaleY,
        width: (Math.min(preview.right, target.right) - left) * scaleX,
        height: (Math.min(preview.bottom, target.bottom) - top) * scaleY,
      };
    }
    if (region.width <= 0 || region.height <= 0) return [];
    const codes = new Map<string, ScannedCode>();
    // Zoom the full crop first, then search overlapping areas on still images:
    // close rows of Code 128 symbols are sometimes missed in a wide pass.
    const crops = enhance ? [[0, 0, 1, 1], [0, 0, 1, 1]] : [[0, 0, 1, 1]];
    if (enhance && !video) crops.push([0, 0, .65, 1], [.35, 0, .65, 1],
      [0, 0, .65, .65], [.35, 0, .65, .65], [0, .35, .65, .65], [.35, .35, .65, .65]);
    for (const [index, [x, y, w, h]] of crops.entries()) {
      const sourceWidth = region.width * w, sourceHeight = region.height * h;
      const scale = index > 0 ? Math.min(2, 2400 / Math.max(sourceWidth, sourceHeight))
        : Math.min(video ? 1 : 3, 1920 / Math.max(width, height));
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, region.x + region.width * x, region.y + region.height * y,
        sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const results = await readBarcodes(context.getImageData(0, 0, canvas.width, canvas.height),
        { ...options, maxNumberOfSymbols: 8 });
      const valid = results.filter(row => row.isValid && !row.error && row.text);
      if (frame && valid.length > 1) {
        const distance = (row: typeof valid[number]) => {
          const corners = Object.values(row.position);
          const x = corners.reduce((sum, point) => sum + point.x, 0) / (corners.length * canvas.width);
          const y = corners.reduce((sum, point) => sum + point.y, 0) / (corners.length * canvas.height);
          return (x - 0.5) ** 2 + (y - 0.5) ** 2;
        };
        valid.sort((a, b) => distance(a) - distance(b));
      }
      for (const result of valid) {
        // UPC-A and an EAN-13 symbol with a leading zero have the same bars.
        const paddedUpc = result.format === "EAN13" && /^0[0-9]{12}$/.test(result.text);
        const text = paddedUpc ? result.text.slice(1) : result.text;
        const format = result.format.startsWith("QRCode") ? "QR-Code"
          : result.format === "UPCA" || paddedUpc ? "UPC-A"
          : result.format === "EAN8" ? "EAN-8" : result.format === "EAN13" ? "EAN-13"
          : result.format.startsWith("Code39") ? "Code 39" : "Code 128";
        const fields = format === "QR-Code" || format.startsWith("Code") ? labelledCodes(text) : [];
        const decoded = fields.length ? fields.map(field => ({ ...field, format, labelled: true }))
          : [{ text, type: identifierType(text, format), format }];
        for (const code of decoded) {
          if (!codes.has(`${code.type}:${code.text}`)) codes.set(`${code.type}:${code.text}`, code);
        }
      }
      if (enhance && video && index === 1 && [...codes.values()].filter(code => code.type === "ean" || code.type === "upc").length === 1) {
        // A nearby, more readable UPC can dominate the first pass. Search both
        // sides of the same viewfinder, including the quieter barcode.
        crops.push([0, 0, .66, 1], [.34, 0, .66, 1], [0, .32, 1, .68]);
      }
    }
    return [...codes.values()].slice(0, 8);
  };
}
