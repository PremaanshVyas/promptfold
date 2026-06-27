/**
 * Artifact parsing, the one part of promptfold that fights Claude's shifting,
 * undocumented data format. Isolated here so it can be fixed without touching
 * anything else.
 *
 * Three formats have shipped over time; all three are handled:
 *   1. tool_use block, name "artifacts" or "create_file",
 *      content in input.display_content (code_block OR json_block w/ filename).
 *   2. legacy <antArtifact ...>...</antArtifact> tags embedded in assistant text.
 *
 * Design rule: classify every block. A block is exactly one of:
 *   - "text"               → contributes to message text
 *   - "artifact"           → an Artifact (any of the 3 formats)
 *   - "tool-noise"         → a known non-artifact tool (bash, tool_result) we drop
 *   - "unknown"            → could NOT classify → surfaced loudly, never dropped
 */

import type { Artifact, ClaudeContentBlock } from "../../../types.js";

export type BlockClassification =
  | { kind: "text"; text: string }
  | { kind: "artifact"; artifact: Omit<Artifact, "id"> }
  | { kind: "tool"; block: ClaudeContentBlock } // file ops, replayed by the engine
  | { kind: "tool-noise"; hint: string }
  | { kind: "unknown"; hint: string; preview: string };

const ANT_ARTIFACT_RE =
  /<antArtifact\b([^>]*)>([\s\S]*?)<\/antArtifact>/g;

function truncate(s: string, max = 200): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

/** Pull `key="value"` attributes out of an antArtifact opening tag. */
function parseAttrs(attrChunk: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrChunk)) !== null) {
    const key = m[1];
    const val = m[2];
    if (key !== undefined && val !== undefined) out[key] = val;
  }
  return out;
}

/**
 * Extract antArtifact tags from a text body.
 * Returns the artifacts found AND the text with those tags removed.
 */
export function extractAntArtifactsFromText(
  text: string,
  messageUuid: string,
): { artifacts: Array<Omit<Artifact, "id">>; remainingText: string } {
  const artifacts: Array<Omit<Artifact, "id">> = [];
  ANT_ARTIFACT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANT_ARTIFACT_RE.exec(text)) !== null) {
    const attrs = parseAttrs(m[1] ?? "");
    const content = m[2] ?? "";
    artifacts.push({
      format: "antartifact",
      messageUuid,
      content,
      ...(attrs.title ? { title: attrs.title } : {}),
      ...(attrs.identifier && /\./.test(attrs.identifier)
        ? { filename: attrs.identifier }
        : {}),
      ...(attrs.language || attrs.type
        ? { language: attrs.language ?? attrs.type }
        : {}),
    });
  }
  const remainingText = text.replace(ANT_ARTIFACT_RE, "").trim();
  return { artifacts, remainingText };
}

/**
 * Read a LEGACY artifact out of a tool_use block's `input.display_content`
 * (the pre-sandbox `artifacts` channel). The current file-sandbox tools
 * (create_file/str_replace/…) are NOT handled here, they are replayed by the
 * reconstruction engine instead. Returns null when there is no display_content
 * artifact.
 */
function readDisplayContentArtifact(
  block: ClaudeContentBlock,
  messageUuid: string,
): Omit<Artifact, "id"> | null {
  const input = block.input;
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  const display = obj["display_content"];

  // json_block: display_content is a JSON string.
  if (typeof display === "string") {
    try {
      const parsed = JSON.parse(display) as Record<string, unknown>;
      const filename = parsed["filename"];
      if (typeof filename === "string" && filename.length > 0) {
        const code = parsed["code"] ?? parsed["content"];
        return {
          format: "tool_use",
          messageUuid,
          filename,
          content: typeof code === "string" ? code : display,
          ...(typeof parsed["language"] === "string"
            ? { language: parsed["language"] as string }
            : {}),
          ...(typeof parsed["title"] === "string"
            ? { title: parsed["title"] as string }
            : {}),
        };
      }
    } catch {
      // Not JSON, fall through; handled as unknown by the caller's filename check.
    }
    return null;
  }

  // code_block: display_content is an object with filename + code/content.
  if (display && typeof display === "object") {
    const dobj = display as Record<string, unknown>;
    const filename = dobj["filename"];
    if (typeof filename === "string" && filename.length > 0) {
      const code = dobj["code"] ?? dobj["content"] ?? "";
      return {
        format: "tool_use",
        messageUuid,
        filename,
        content: typeof code === "string" ? code : JSON.stringify(code),
        ...(typeof dobj["language"] === "string"
          ? { language: dobj["language"] as string }
          : {}),
        ...(typeof dobj["title"] === "string"
          ? { title: dobj["title"] as string }
          : {}),
      };
    }
  }

  return null;
}

export interface SearchSource {
  title: string;
  url: string;
}
export interface SearchContext {
  sources: SearchSource[];
  images: Array<{ alt: string; url: string }>;
}

const IMG_URL_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|#|$)/i;
const isHttp = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

/**
 * Mine a search-result block (web_search_tool_result / tool_result / knowledge)
 * for its sources and any image URLs. claude.ai search results carry the SUBJECT
 * of what was found in each result's `title` (e.g. "Liquid IV Tropical stick
 * pack…"), which is exactly what a downstream session needs when an image was
 * shown. We deep-walk because the nesting shape is undocumented and shifts.
 */
export function extractSearchContext(block: ClaudeContentBlock): SearchContext {
  const sources: SearchSource[] = [];
  const images: Array<{ alt: string; url: string }> = [];
  const seenSrc = new Set<string>();
  const seenImg = new Set<string>();

  const addImage = (url: string, alt?: string): void => {
    if (!isHttp(url) || seenImg.has(url)) return;
    seenImg.add(url);
    images.push({ alt: alt && alt.trim() ? alt.trim() : "image", url });
  };

  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const e of x) walk(e);
      return;
    }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    const title =
      (typeof o["title"] === "string" && o["title"]) ||
      (typeof o["page_title"] === "string" && o["page_title"]) ||
      "";
    const url = typeof o["url"] === "string" ? o["url"] : undefined;
    if (isHttp(url)) {
      if (IMG_URL_RE.test(url)) addImage(url, title || undefined);
      else if (title && !seenSrc.has(url)) {
        seenSrc.add(url);
        sources.push({ title, url });
      }
    }
    // Explicit image fields some result shapes use.
    for (const k of ["image_url", "thumbnail_url", "thumbnail", "image", "img_url"]) {
      const v = o[k];
      if (isHttp(v)) addImage(v, title || undefined);
      else if (v && typeof v === "object" && isHttp((v as Record<string, unknown>)["url"]))
        addImage((v as Record<string, unknown>)["url"] as string, title || undefined);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(block.content);
  return { sources, images };
}

/** Citations attached to a text block (web_search_result_location): {title,url}. */
export function extractCitations(block: ClaudeContentBlock): SearchSource[] {
  const out: SearchSource[] = [];
  const cites = block["citations"];
  if (!Array.isArray(cites)) return out;
  for (const c of cites) {
    if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      const url = typeof o["url"] === "string" ? o["url"] : undefined;
      if (isHttp(url)) out.push({ title: typeof o["title"] === "string" ? o["title"] : url, url });
    }
  }
  return out;
}

/**
 * Classify a single content block. Pure and total: every block returns exactly
 * one classification. The caller is responsible for assembling text + artifacts
 * and for treating "unknown" loudly.
 */
export function classifyBlock(
  block: ClaudeContentBlock,
  messageUuid: string,
): BlockClassification {
  const type = typeof block.type === "string" ? block.type : "";

  if (type === "text") {
    return { kind: "text", text: typeof block.text === "string" ? block.text : "" };
  }

  if (type === "image") {
    // An image is a real content type. Surface it as a markdown image so the
    // distiller's image extractor captures it (URL when present; otherwise a
    // bare note so a content-complete handoff records that an image was shown).
    const src = (block as { source?: unknown }).source;
    let url = "";
    if (src && typeof src === "object") {
      const s = src as Record<string, unknown>;
      if (typeof s["url"] === "string") url = s["url"] as string;
      else if (typeof s["image_url"] === "string") url = s["image_url"] as string;
    }
    const alt = typeof block.alt_text === "string" ? block.alt_text : "image";
    return { kind: "text", text: url ? `![${alt}](${url})` : `[image shown in chat: ${alt}]` };
  }

  if (type === "tool_use") {
    // Legacy display_content artifacts are captured inline here. Everything else
    // tool-shaped (create_file/str_replace/insert/bash/present_files/…) is handed
    // to the reconstruction engine, which replays it into final files.
    const legacy = readDisplayContentArtifact(block, messageUuid);
    if (legacy) return { kind: "artifact", artifact: legacy };
    return { kind: "tool", block };
  }

  if (type === "tool_result" || type === "web_search_tool_result" || type === "knowledge") {
    // Mined for sources/images by the normalizer before being dropped from text.
    return { kind: "tool-noise", hint: type };
  }

  if (type === "thinking" || type === "redacted_thinking") {
    // Internal reasoning, not part of the shareable record. Drop as noise.
    return { kind: "tool-noise", hint: type };
  }

  // Anything we have never seen: surface loudly.
  return {
    kind: "unknown",
    hint: type ? `type:${type}` : "no-type",
    preview: truncate(JSON.stringify(block)),
  };
}
