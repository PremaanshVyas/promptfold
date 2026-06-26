/**
 * Chunking for long chats. A 200-message conversation is often too big to
 * distill in one pass, so we split it on message boundaries into char-bounded
 * chunks. Each chunk becomes a mini-brief; the merge step recombines them.
 *
 * We split on whole messages (never mid-message) so no decision is cut in half.
 * Char budget is a proxy for tokens, deliberately conservative.
 */

import type { NormalizedTranscript } from "../types.js";
import { collapseArtifactLineage } from "./dedupe.js";

/** Roughly 4 chars/token; 16k chars ≈ 4k tokens of input per chunk. */
export const DEFAULT_CHUNK_CHARS = 16_000;

function renderMessage(role: string, text: string): string {
  const who = role === "assistant" ? "Assistant" : "User";
  return `### ${who}\n${text}`;
}

/**
 * Render a transcript to a single plain-text document, artifacts appended with
 * clear delimiters so the model sees the final code as well as the discussion.
 */
export function renderTranscriptText(transcript: NormalizedTranscript): string {
  const parts: string[] = [];
  for (const m of transcript.messages) {
    if (m.text.length > 0) parts.push(renderMessage(m.role, m.text));
  }
  for (const a of collapseArtifactLineage(transcript.artifacts)) {
    const name = a.filename ?? a.title ?? a.id;
    parts.push(
      `### Artifact: ${name}${a.language ? ` (${a.language})` : ""}\n` +
        "```\n" +
        a.content +
        "\n```",
    );
  }
  return parts.join("\n\n");
}

export interface ChunkOptions {
  maxChars?: number;
}

/**
 * Split a transcript into text chunks, each ≤ maxChars where possible, never
 * splitting a single message/artifact across chunks (oversized single units are
 * emitted whole, better a too-big chunk than a severed decision).
 */
export function chunkTranscript(
  transcript: NormalizedTranscript,
  opts: ChunkOptions = {},
): string[] {
  const maxChars = opts.maxChars ?? DEFAULT_CHUNK_CHARS;

  const units: string[] = [];
  for (const m of transcript.messages) {
    if (m.text.length > 0) units.push(renderMessage(m.role, m.text));
  }
  for (const a of collapseArtifactLineage(transcript.artifacts)) {
    const name = a.filename ?? a.title ?? a.id;
    units.push(
      `### Artifact: ${name}${a.language ? ` (${a.language})` : ""}\n` +
        "```\n" +
        a.content +
        "\n```",
    );
  }

  if (units.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const unit of units) {
    const unitLen = unit.length + 2; // + separator
    if (currentLen + unitLen > maxChars && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLen = 0;
    }
    current.push(unit);
    currentLen += unitLen;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));

  return chunks;
}
