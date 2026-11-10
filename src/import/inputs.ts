import type { AiInput } from "./aiExtract";

export type RawInput =
  | { id: string; kind: "text"; label: string; text: string }
  | { id: string; kind: "file"; label: string; file: File };

export function fileKind(file: File): "pdf" | "image" | "text" | "unknown" {
  const t = file.type;
  const n = file.name.toLowerCase();
  if (t === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif)$/.test(n)) return "image";
  if (t.startsWith("text/") || /\.(txt|csv|md|html?|json)$/.test(n)) return "text";
  return "unknown";
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

const API_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type ApiImageType = (typeof API_IMAGE_TYPES)[number];
const MAX_SIDE = 2000;
const MAX_IMAGE_BYTES = 4_500_000;

/** Re-encode images the API can't take as-is (wrong type, too large, too many pixels). */
async function prepareImage(file: File): Promise<{ base64: string; mediaType: ApiImageType }> {
  const okType = (API_IMAGE_TYPES as readonly string[]).includes(file.type);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (!okType) throw new Error(`Can't read ${file.name}. Try a PNG or JPEG.`);
  }
  const tooBig = bitmap ? Math.max(bitmap.width, bitmap.height) > MAX_SIDE : false;
  if (okType && !tooBig && file.size <= MAX_IMAGE_BYTES) {
    bitmap?.close();
    return { base64: toBase64(await file.arrayBuffer()), mediaType: file.type as ApiImageType };
  }
  if (!bitmap) throw new Error(`Can't read ${file.name}.`);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Image encode failed"))), "image/jpeg", 0.9),
  );
  return { base64: toBase64(await blob.arrayBuffer()), mediaType: "image/jpeg" };
}

export async function toAiInput(raw: RawInput): Promise<AiInput> {
  if (raw.kind === "text") return { kind: "text", label: raw.label, text: raw.text };
  const k = fileKind(raw.file);
  if (k === "pdf") return { kind: "pdf", label: raw.label, base64: toBase64(await raw.file.arrayBuffer()) };
  if (k === "image") return { kind: "image", label: raw.label, ...(await prepareImage(raw.file)) };
  return { kind: "text", label: raw.label, text: await raw.file.text() };
}

/** Extract text from a PDF with pdf.js, one line per text row. Loaded lazily. */
export async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = "";
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      line += it.str;
      if (it.hasEOL) {
        out.push(line);
        line = "";
      } else if (it.str && !line.endsWith(" ")) line += " ";
    }
    if (line.trim()) out.push(line);
  }
  await task.destroy();
  return out.map((l) => l.replace(/\s+/g, " ").trim()).join("\n");
}
