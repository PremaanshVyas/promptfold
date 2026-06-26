/**
 * Artifact parsing — the one part of carrybot that fights Claude's shifting,
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

import type { Artifact, ClaudeContentBlock } from "../types.js";

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
 * (create_file/str_replace/…) are NOT handled here — they are replayed by the
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
      // Not JSON — fall through; handled as unknown by the caller's filename check.
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

  if (type === "tool_use") {
    // Legacy display_content artifacts are captured inline here. Everything else
    // tool-shaped (create_file/str_replace/insert/bash/present_files/…) is handed
    // to the reconstruction engine, which replays it into final files.
    const legacy = readDisplayContentArtifact(block, messageUuid);
    if (legacy) return { kind: "artifact", artifact: legacy };
    return { kind: "tool", block };
  }

  if (type === "tool_result") {
    return { kind: "tool-noise", hint: "tool_result" };
  }

  if (type === "thinking" || type === "redacted_thinking") {
    // Internal reasoning — not part of the shareable record. Drop as noise.
    return { kind: "tool-noise", hint: type };
  }

  // Anything we have never seen: surface loudly.
  return {
    kind: "unknown",
    hint: type ? `type:${type}` : "no-type",
    preview: truncate(JSON.stringify(block)),
  };
}
