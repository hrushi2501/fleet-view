import "server-only";

import { put } from "@vercel/blob";
import { ActionError } from "@/lib/guard";

/** Files accepted as evidence or regulated documents. SVG/HTML are deliberately
 * excluded: serving user-provided active content under an application origin is
 * an XSS risk, even when a browser's file picker says it is an image. */
const FILE_TYPES = {
  jpg: { contentType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  png: { contentType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  webp: { contentType: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  pdf: { contentType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
} as const;

export type PrivateUploadKind = "image" | "document";

/** Images are evidence, not source video. Documents get a little more room for scans. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_UPLOAD_BYTES = 10 * 1024 * 1024;

type DetectedFile = { extension: keyof typeof FILE_TYPES; contentType: string };

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Determines the media type from magic bytes instead of trusting a filename or
 * browser-provided Content-Type. A WebP RIFF header additionally needs WEBP at
 * bytes 8–11 so an arbitrary RIFF file cannot masquerade as an image.
 */
export function detectAllowedFile(bytes: Uint8Array): DetectedFile | null {
  if (hasPrefix(bytes, FILE_TYPES.jpg.bytes)) return { extension: "jpg", contentType: FILE_TYPES.jpg.contentType };
  if (hasPrefix(bytes, FILE_TYPES.png.bytes)) return { extension: "png", contentType: FILE_TYPES.png.contentType };
  if (hasPrefix(bytes, FILE_TYPES.pdf.bytes)) return { extension: "pdf", contentType: FILE_TYPES.pdf.contentType };
  if (hasPrefix(bytes, FILE_TYPES.webp.bytes) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return { extension: "webp", contentType: FILE_TYPES.webp.contentType };
  }
  return null;
}

function safeFolder(folder: string) {
  const normalised = folder.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalised) throw new ActionError("Upload destination is invalid.");
  return normalised;
}

/** The database stores this application URL, never a publicly readable Blob URL. */
export function privateFileUrl(blobUrl: string) {
  return `/api/files?blob=${encodeURIComponent(blobUrl)}`;
}

/**
 * Validates and stores a user-supplied file as a private Vercel Blob.
 *
 * The proxy URL returned here is access-controlled by `/api/files`; Vercel's
 * private object URL alone cannot be opened by a browser. Callers therefore do
 * not need to expose a long-lived signed URL in a database row or page HTML.
 */
export async function uploadPrivateFile(
  file: File,
  { folder, kind }: { folder: string; kind: PrivateUploadKind },
): Promise<string> {
  const maximumSize = kind === "image" ? MAX_IMAGE_UPLOAD_BYTES : MAX_DOCUMENT_UPLOAD_BYTES;
  if (file.size <= 0) throw new ActionError("Choose a non-empty file.");
  if (file.size > maximumSize) {
    throw new ActionError(`File is too large. Maximum ${kind === "image" ? "image" : "document"} size is ${maximumSize / 1024 / 1024} MB.`);
  }

  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectAllowedFile(signature);
  if (!detected || (kind === "image" && detected.extension === "pdf")) {
    throw new ActionError(kind === "image"
      ? "Upload a JPEG, PNG, or WebP image."
      : "Upload a JPEG, PNG, WebP, or PDF document.");
  }

  // A non-empty declared type that conflicts with the bytes is a tampered or
  // malformed upload. Empty is tolerated because some mobile browsers omit it.
  if (file.type && file.type !== detected.contentType) {
    throw new ActionError("The file type does not match its contents.");
  }

  const blob = await put(
    `${safeFolder(folder)}/${Date.now()}.${detected.extension}`,
    file,
    {
      access: "private",
      addRandomSuffix: true,
      contentType: detected.contentType,
      maximumSizeInBytes: maximumSize,
    },
  );
  return privateFileUrl(blob.url);
}
