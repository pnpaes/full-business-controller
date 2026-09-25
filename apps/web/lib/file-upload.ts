import type { StoredFile } from "@aquarela/application";

/**
 * Shared multipart-upload parsing and download framing for the file-storage
 * consumers wired after the document library (`DEC-132`, extended by `DEC-133`).
 *
 * Each consumer supplies its own allow-list and size cap (`FileUploadPolicy`),
 * because the safe classes differ: a payroll export is a CSV/PDF artefact, a
 * personnel document is a contract or certificate, and HMS evidence is a photo
 * or a service report. The check is on the caller-supplied `File.type` only —
 * **content-signature sniffing is a recorded deferral** (`DEC-133`), so a
 * renamed file is not detected here.
 *
 * `fileAttachmentResponse` is the read half: the stored bytes with the stored
 * `Content-Type`, a `Content-Disposition` that cannot inject a header, `nosniff`
 * and `private, no-store`. It duplicates the document-library responder
 * (`apps/web/app/api/v1/documents/document-rows.ts:514`) deliberately rather
 * than change that already-wired route; both are small and pure.
 */

export interface FileUploadPolicy {
  /** Allowed caller-supplied MIME types, lowercase. */
  readonly allowedMime: readonly string[];
  /** Maximum byte length of the uploaded file. */
  readonly maxBytes: number;
}

export interface ParsedUpload {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export type UploadParseResult =
  | { readonly ok: true; readonly upload: ParsedUpload }
  | { readonly ok: false; readonly reason: "malformed" | "type" | "size" };

const MAX_FILENAME = 255;

/**
 * Parses a `multipart/form-data` body's required `file` part against `policy`.
 * A missing/empty file part or an unreadable name is `"malformed"`; a type
 * outside the allow-list is `"type"`; a file over the cap is `"size"` (checked
 * on `File.size` before the bytes are read, then again on the read length, so an
 * oversized upload is not buffered). The caller maps each reason to a 400.
 */
export async function parseUploadForm(
  form: FormData,
  policy: FileUploadPolicy,
): Promise<UploadParseResult> {
  const file = form.get("file");
  if (file === null || typeof file === "string") {
    return { ok: false, reason: "malformed" };
  }
  const filename = typeof file.name === "string" ? file.name.trim() : "";
  if (filename.length === 0 || filename.length > MAX_FILENAME) {
    return { ok: false, reason: "malformed" };
  }
  const mime =
    typeof file.type === "string" && file.type.trim().length > 0
      ? file.type.trim().toLowerCase()
      : "application/octet-stream";
  if (!policy.allowedMime.includes(mime)) {
    return { ok: false, reason: "type" };
  }
  if (file.size > policy.maxBytes) {
    return { ok: false, reason: "size" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return { ok: false, reason: "malformed" };
  }
  if (bytes.byteLength > policy.maxBytes) {
    return { ok: false, reason: "size" };
  }
  return { ok: true, upload: { filename, mime, bytes } };
}

/**
 * A safe `Content-Disposition: attachment` value. The ASCII fallback has
 * quotes/backslashes and every non-ASCII or control character replaced, and the
 * RFC 5987 `filename*` carries the real name percent-encoded, so a filename can
 * never inject a header or break the framing.
 */
export function contentDisposition(filename: string): string {
  const asciiFallback =
    filename
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .slice(0, 200) || "download";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** A fresh `ArrayBuffer` so `Response` accepts the bytes whatever backs the array. */
function toResponseBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** One stored file as a private, attachment download (no-store, nosniff). */
export function fileAttachmentResponse(stored: StoredFile): Response {
  return new Response(toResponseBody(stored.bytes), {
    status: 200,
    headers: {
      "Content-Type": stored.metadata.mime,
      "Content-Length": String(stored.metadata.sizeBytes),
      "Content-Disposition": contentDisposition(stored.metadata.filename),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * True when a request body is `multipart/form-data` (so a route can accept an
 * optional file upload alongside its legacy JSON shape).
 */
export function isMultipart(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().trimStart().startsWith("multipart/form-data");
}
