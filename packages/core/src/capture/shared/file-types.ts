/**
 * File-type reference. Drives one decision: can this file's content be shown
 * inline (TEXT), or must it always be listed as an attachment (BINARY)?
 *
 * Sourced from MDN Common MIME types + IANA. Binary deliverables (pdf, docx,
 * xlsx, images, archives) are never inlined, we don't have their real bytes
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

/** Last path segment, e.g. "/mnt/.../essay.md" → "essay.md". */
export function basenameOf(path: string): string {
  return path.replace(/\/+$/, "").split(/[\\/]/).pop() ?? path;
}

/** Lower-cased extension without the dot, or "" if none. */
export function extOf(filename: string): string {
  const base = basenameOf(filename);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Lower-cased basename without extension, the key for treating the SAME logical
 * file under different paths/extensions (essay.md, essay.txt, outputs/essay.md)
 * as one. Used to dedupe the files-to-attach list.
 */
export function stemOf(path: string): string {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

/**
 * A model sandbox path: Claude's (/mnt/user-data, /home/claude, /tmp) or
 * ChatGPT's (sandbox:/mnt/data, /mnt/data). These are session-local working
 * paths, not the user's own files, and they will NOT exist in a new chat, so
 * they must never be presented as an authoritative file to open/attach.
 */
export function isSandboxPath(path: string): boolean {
  return (
    /^sandbox:/i.test(path) ||
    /\/(mnt\/user-data|mnt\/data|home\/claude|tmp)\//.test("/" + path.replace(/^sandbox:/i, ""))
  );
}

/** True when a file's bytes must be attached rather than inlined. */
export function isBinaryFile(filename: string): boolean {
  return BINARY_EXTS.has(extOf(filename));
}
