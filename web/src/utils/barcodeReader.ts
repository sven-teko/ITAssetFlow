import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import type { CodeType } from "./scannerCodes";

export type ScannedCode = { text: string; type: CodeType; format: string };
type Source = HTMLVideoElement | HTMLImageElement;

const options: ReaderOptions = {
  formats: ["QRCode", "EAN8", "EAN13", "Code128", "Code39"],
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

  return async (source: Source, enhance = false): Promise<ScannedCode | null> => {
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return null;
    const aspect = source instanceof HTMLVideoElement && source.clientHeight ? source.clientWidth / source.clientHeight : width / height;
    // Match object-fit: cover: only scan pixels actually visible in the preview.
    const visibleWidth = Math.min(width, height * aspect), visibleHeight = Math.min(height, width / aspect);
    // First read the entire image. A magnified centre also helps small barcodes.
    for (const centre of enhance ? [false, true] : [false]) {
      const portion = centre ? 0.7 : 1;
      const sourceWidth = visibleWidth * portion, sourceHeight = visibleHeight * portion;
      const scale = centre ? Math.min(2, 2400 / Math.max(sourceWidth, sourceHeight))
        : Math.min(source instanceof HTMLVideoElement ? 1 : 3, 1920 / Math.max(width, height));
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, (width - sourceWidth) / 2, (height - sourceHeight) / 2,
        sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const results = await readBarcodes(context.getImageData(0, 0, canvas.width, canvas.height), options);
      const result = results.find(row => row.isValid && !row.error && row.text);
      if (!result) continue;
      if (result.format.startsWith("QRCode")) return { text: result.text, type: "qr", format: "QR-Code" };
      if (result.format === "EAN8" || result.format === "EAN13") {
        return { text: result.text, type: "ean", format: result.format === "EAN8" ? "EAN-8" : "EAN-13" };
      }
      return { text: result.text, type: "auto", format: result.format.startsWith("Code39") ? "Code 39" : "Code 128" };
    }
    return null;
  };
}
