/**
 * File-type reference. Drives one decision: can this file's content be shown
 * inline (TEXT), or must it always be listed as an attachment (BINARY)?
 *
 * Sourced from MDN Common MIME types + IANA. Binary deliverables (pdf, docx,
 * xlsx, images, archives) are never inlined — we don't have their real bytes
 * (they're produced by code we can't replay) and they'd be gibberish anyway.
 */

const BINARY_EXTS = new Set([
  // documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  // images
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "tif", "tiff", "heic",
  // audio / video
  "mp3", "wav", "ogg", "flac", "mp4", "mov", "avi", "mkv", "webm",
  // archives / binaries
  "zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz", "exe", "dll", "bin",
  "wasm", "woff", "woff2", "ttf", "otf",
]);

/** Lower-cased extension without the dot, or "" if none. */
export function extOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** True when a file's bytes must be attached rather than inlined. */
export function isBinaryFile(filename: string): boolean {
  return BINARY_EXTS.has(extOf(filename));
}
