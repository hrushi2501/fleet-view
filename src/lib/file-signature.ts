/**
 * Pure file-signature recognition, intentionally separate from upload/storage
 * so it can be tested without loading server-only Blob credentials.
 */
const FILE_TYPES = {
  jpg: { contentType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  png: { contentType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  webp: { contentType: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  pdf: { contentType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  webm: { contentType: "audio/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  ogg: { contentType: "audio/ogg", bytes: [0x4f, 0x67, 0x67, 0x53] },
} as const;

export type DetectedFile = { extension: keyof typeof FILE_TYPES | "m4a"; contentType: string };

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/** Recognizes only inert evidence/document/audio containers from magic bytes. */
export function detectAllowedFile(bytes: Uint8Array): DetectedFile | null {
  if (hasPrefix(bytes, FILE_TYPES.jpg.bytes)) return { extension: "jpg", contentType: FILE_TYPES.jpg.contentType };
  if (hasPrefix(bytes, FILE_TYPES.png.bytes)) return { extension: "png", contentType: FILE_TYPES.png.contentType };
  if (hasPrefix(bytes, FILE_TYPES.pdf.bytes)) return { extension: "pdf", contentType: FILE_TYPES.pdf.contentType };
  if (hasPrefix(bytes, FILE_TYPES.webp.bytes) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return { extension: "webp", contentType: FILE_TYPES.webp.contentType };
  }
  if (hasPrefix(bytes, FILE_TYPES.webm.bytes)) return { extension: "webm", contentType: FILE_TYPES.webm.contentType };
  if (hasPrefix(bytes, FILE_TYPES.ogg.bytes)) return { extension: "ogg", contentType: FILE_TYPES.ogg.contentType };
  // MP4/M4A identifies its container by `ftyp` at bytes 4–7. The upload layer
  // additionally requires an audio MIME before accepting it as a voice note.
  if (String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") return { extension: "m4a", contentType: "audio/mp4" };
  return null;
}
