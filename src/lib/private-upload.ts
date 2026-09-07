import "server-only";

import { put } from "@vercel/blob";
import { ActionError } from "@/lib/guard";
import { detectAllowedFile } from "@/lib/file-signature";

export { detectAllowedFile } from "@/lib/file-signature";

/** Files accepted as evidence or regulated documents. SVG/HTML are deliberately
 * excluded: serving user-provided active content under an application origin is
 * an XSS risk, even when a browser's file picker says it is an image. */
export type PrivateUploadKind = "image" | "document" | "audio";

/** Images are evidence, not source video. Documents get a little more room for scans. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_UPLOAD_BYTES = 10 * 1024 * 1024;
/** A short spoken field report; bounded for low-bandwidth phones and Blob cost. */
export const MAX_AUDIO_UPLOAD_BYTES = 8 * 1024 * 1024;

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
  const maximumSize = kind === "image"
    ? MAX_IMAGE_UPLOAD_BYTES
    : kind === "audio"
      ? MAX_AUDIO_UPLOAD_BYTES
      : MAX_DOCUMENT_UPLOAD_BYTES;
  if (file.size <= 0) throw new ActionError("Choose a non-empty file.");
  if (file.size > maximumSize) {
    throw new ActionError(`File is too large. Maximum ${kind} size is ${maximumSize / 1024 / 1024} MB.`);
  }

  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectAllowedFile(signature);
  const allowed = kind === "image"
    ? detected?.extension === "jpg" || detected?.extension === "png" || detected?.extension === "webp"
    : kind === "audio"
      ? detected?.extension === "webm" || detected?.extension === "ogg" || detected?.extension === "m4a"
      : detected?.extension === "jpg" || detected?.extension === "png" || detected?.extension === "webp" || detected?.extension === "pdf";
  if (!detected || !allowed) {
    throw new ActionError(kind === "image"
      ? "Upload a JPEG, PNG, or WebP image."
      : kind === "audio"
        ? "Upload a WebM, OGG, or M4A audio recording."
        : "Upload a JPEG, PNG, WebP, or PDF document.");
  }

  // A non-empty declared type that conflicts with the bytes is a tampered or
  // malformed upload. Empty is tolerated because some mobile browsers omit it.
  const declaredType = file.type.split(";", 1)[0]?.toLowerCase();
  if (declaredType && declaredType !== detected.contentType) {
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
