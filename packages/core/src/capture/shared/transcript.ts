/**
 * Shared helper: build a NormalizedTranscript from a plain {role, text} list.
 *
 * The bridge used by the simpler adapters (Perplexity, DeepSeek, Grok,
 * HuggingFace) and the generic DOM reader: collect visible messages, hand them
 * here, and core assembles the transcript. No artifacts (those adapters that
 * have them add their own).
 */

import type {
  NormalizedMessage,
  NormalizedTranscript,
  Role,
} from "../../types.js";

export interface SimpleMessage {
  role: Role;
  text: string;
}

export function transcriptFromMessages(
  msgs: SimpleMessage[],
  meta: { conversationId: string; title: string; capturedAt: string },
): NormalizedTranscript {
  const messages: NormalizedMessage[] = msgs
    .filter((m) => m.text.trim().length > 0)
    .map((m, i) => ({ uuid: `dom-${i}`, role: m.role, text: m.text.trim() }));
  return {
    conversationId: meta.conversationId,
    title: meta.title.trim() || "Untitled conversation",
    capturedAt: meta.capturedAt,
    messages,
    artifacts: [],
    uploads: [],
    integrity: {
      totalBlocks: messages.length,
      classifiedBlocks: messages.length,
      unknown: [],
      complete: true,
    },
  };
}
