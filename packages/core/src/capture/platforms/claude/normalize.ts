/**
 * Normalize a raw Claude conversation into a clean transcript.
 *
 * Responsibilities:
 *   - Reconstruct the ACTIVE branch (Claude returns a message tree when
 *     tree=True; we walk parent pointers from the current leaf).
 *   - Classify every content block (text / artifact / noise / unknown).
 *   - Pull artifacts out of message bodies (both tool_use and antArtifact).
 *   - Produce an IntegrityReport so completeness is provable, not assumed.
 *
 * Pure: no network, no Date.now, `capturedAt` is passed in by the caller.
 */

import type {
  Artifact,
  ClaudeContentBlock,
  ClaudeConversation,
  ClaudeMessage,
  IntegrityReport,
  NormalizedMessage,
  NormalizedTranscript,
  Role,
  UnknownBlock,
  UploadedFile,
} from "../../../types.js";
import {
  classifyBlock,
  extractAntArtifactsFromText,
  extractCitations,
  extractSearchContext,
  imageSubjectOf,
} from "./artifact-parser.js";
import { reconstructFiles } from "./reconstruct.js";

function toRole(sender: string | undefined): Role {
  return sender === "assistant" ? "assistant" : "human";
}

/**
 * One concise subject for a set of image labels: the shared leading words
 * ("Liquid IV Tropical", "Liquid IV Lemon Lime" -> "Liquid IV"), so a
 * multi-thumbnail search collapses to its actual subject rather than a gallery.
 * Falls back to the first meaningful label.
 */
function commonSubject(labels: string[]): string {
  const clean = labels.map((l) => l.trim()).filter((l) => l && l.toLowerCase() !== "image");
  if (clean.length === 0) return "image";
  if (clean.length === 1) return clean[0]!;
  const wordLists = clean.map((l) => l.split(/\s+/));
  const first = wordLists[0]!;
  let i = 0;
  for (; i < first.length; i++) {
    const w = first[i]!.toLowerCase();
    if (!wordLists.every((ws) => (ws[i] ?? "").toLowerCase() === w)) break;
  }
  const prefixWords = first.slice(0, i);
  // Require a 2+ word shared prefix (a real brand-level subject like "Liquid
  // IV"); a 1-word prefix ("Liquid") is a fragment, fall back to a full label.
  return prefixWords.length >= 2 ? prefixWords.join(" ") : clean[0]!;
}

/**
 * Reconstruct the active conversation path.
 *
 * If `current_leaf_message_uuid` and parent pointers are present, walk from the
 * leaf back to the root and reverse, this yields the branch actually shown,
 * ignoring abandoned edit branches. Otherwise fall back to the raw array order.
 */
export function activeBranch(convo: ClaudeConversation): ClaudeMessage[] {
  const all = convo.chat_messages ?? [];
  const leaf = convo.current_leaf_message_uuid;
  if (!leaf) return all;

  const byUuid = new Map<string, ClaudeMessage>();
  for (const m of all) byUuid.set(m.uuid, m);
  if (!byUuid.has(leaf)) return all;

  const chain: ClaudeMessage[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = leaf;
  while (cursor && byUuid.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const msg: ClaudeMessage = byUuid.get(cursor)!;
    chain.push(msg);
    cursor = msg.parent_message_uuid;
  }
  chain.reverse();
  // Guard: if the walk produced nothing usable, fall back to raw order.
  return chain.length > 0 ? chain : all;
}

/** A monotonic id source, local to one capture so ids never leak across calls. */
type IdGen = () => string;

/**
 * Normalize one message: separate text from artifacts and record any block we
 * could not classify.
 */
function normalizeMessage(
  msg: ClaudeMessage,
  nextArtifactId: IdGen,
): {
  message: NormalizedMessage;
  artifacts: Artifact[];
  toolBlocks: ClaudeContentBlock[];
  totalBlocks: number;
  classifiedBlocks: number;
  unknown: UnknownBlock[];
} {
  const role = toRole(msg.sender);
  const artifacts: Artifact[] = [];
  const toolBlocks: ClaudeContentBlock[] = [];
  const unknown: UnknownBlock[] = [];
  const textParts: string[] = [];
  let totalBlocks = 0;
  let classifiedBlocks = 0;

  // Search sources + images are spread across several blocks of one message
  // (a result block carries titles/urls; text blocks carry citations). Collect
  // them message-wide, then append once so the subject of any shown image and
  // the sources behind an answer survive into the brief.
  const sources = new Map<string, string>(); // url -> title
  const imageLabels: string[] = []; // subjects of every image shown in this message
  let fromSearch = false;

  const blocks = msg.content;
  if (Array.isArray(blocks) && blocks.length > 0) {
    for (const block of blocks) {
      const bt = typeof block.type === "string" ? block.type : "";
      if (bt === "web_search_tool_result" || bt === "tool_result" || bt === "knowledge") {
        const ctx = extractSearchContext(block);
        for (const s of ctx.sources) if (!sources.has(s.url)) sources.set(s.url, s.title);
        for (const im of ctx.images) {
          imageLabels.push(im.alt);
          fromSearch = true;
        }
      }
      if (bt === "image") imageLabels.push(imageSubjectOf(block));
      for (const c of extractCitations(block)) if (!sources.has(c.url)) sources.set(c.url, c.title);

      totalBlocks += 1;
      const c = classifyBlock(block, msg.uuid);
      switch (c.kind) {
        case "text": {
          classifiedBlocks += 1;
          textParts.push(c.text);
          break;
        }
        case "artifact": {
          classifiedBlocks += 1;
          artifacts.push({ id: nextArtifactId(), ...c.artifact });
          break;
        }
        case "tool": {
          classifiedBlocks += 1;
          toolBlocks.push(c.block);
          break;
        }
        case "tool-noise": {
          classifiedBlocks += 1;
          break;
        }
        case "unknown": {
          unknown.push({
            messageUuid: msg.uuid,
            hint: c.hint,
            preview: c.preview,
          });
          break;
        }
      }
    }
  } else if (typeof msg.text === "string") {
    // Older shape: a flat `text` field instead of content blocks.
    totalBlocks += 1;
    classifiedBlocks += 1;
    textParts.push(msg.text);
  }

  // antArtifact tags can be embedded inside text, extract them too.
  let text = textParts.join("\n\n");
  if (text.includes("<antArtifact")) {
    const { artifacts: tagArtifacts, remainingText } =
      extractAntArtifactsFromText(text, msg.uuid);
    for (const a of tagArtifacts) artifacts.push({ id: nextArtifactId(), ...a });
    text = remainingText;
  }

  // Note that an image was shown by its SUBJECT, ONE note for the whole turn
  // (image blocks and search thumbnails combined), never the rot-prone retailer
  // URLs and never an embedded gallery. Sources (non-image citations) keep their
  // title+url, the established pattern.
  if (imageLabels.length > 0) {
    const subject = commonSubject(imageLabels);
    text += `\n\n[image shown: ${subject}${fromSearch ? " (image search)" : ""}]`;
  }
  if (sources.size > 0) {
    const lines = [...sources].map(([url, title]) => `- ${title}: ${url}`);
    text += `\n\nSources:\n${lines.join("\n")}`;
  }

  return {
    message: {
      uuid: msg.uuid,
      role,
      text: text.trim(),
      ...(msg.created_at ? { createdAt: msg.created_at } : {}),
    },
    artifacts,
    toolBlocks,
    totalBlocks,
    classifiedBlocks,
    unknown,
  };
}

export interface NormalizeOptions {
  /** ISO timestamp for when this capture happened (injected; core stays pure). */
  capturedAt: string;
}

// transcriptFromMessages moved to shared/transcript.ts (it's platform-agnostic);
// re-exported here so existing importers keep working.
export {
  transcriptFromMessages,
  type SimpleMessage,
} from "../../shared/transcript.js";

export function normalizeConversation(
  convo: ClaudeConversation,
  opts: NormalizeOptions,
): NormalizedTranscript {
  const branch = activeBranch(convo);

  let artifactCounter = 0;
  const nextArtifactId: IdGen = () => {
    artifactCounter += 1;
    return `artifact-${artifactCounter}`;
  };

  const messages: NormalizedMessage[] = [];
  const artifacts: Artifact[] = [];
  const toolBlocks: ClaudeContentBlock[] = [];
  const unknown: UnknownBlock[] = [];
  const uploadsByName = new Map<string, UploadedFile>();
  let totalBlocks = 0;
  let classifiedBlocks = 0;

  for (const raw of branch) {
    const n = normalizeMessage(raw, nextArtifactId);
    // Keep messages that have text OR produced an artifact; drop fully-empty ones.
    if (n.message.text.length > 0 || n.artifacts.length > 0) {
      messages.push(n.message);
    }
    artifacts.push(...n.artifacts);
    toolBlocks.push(...n.toolBlocks);
    unknown.push(...n.unknown);
    totalBlocks += n.totalBlocks;
    classifiedBlocks += n.classifiedBlocks;

    // Authoritative upload metadata (no reconstruction needed for these).
    for (const att of raw.attachments ?? []) {
      const name = att.file_name?.trim();
      if (name && !uploadsByName.has(name.toLowerCase())) {
        uploadsByName.set(name.toLowerCase(), {
          name,
          ...(att.file_type ? { type: att.file_type } : {}),
        });
      }
    }
  }

  // Replay the sandbox file operations into final deliverables (correct name +
  // fully-edited content), and add them as artifacts.
  const { deliverables } = reconstructFiles(toolBlocks);
  for (const f of deliverables) {
    artifacts.push({
      id: nextArtifactId(),
      filename: f.name,
      content: f.content,
      format: "tool_use",
      messageUuid: "reconstructed",
      ...(f.binary ? { binary: true } : {}),
      ...(f.presented ? { presented: true } : {}),
    });
  }

  const integrity: IntegrityReport = {
    totalBlocks,
    classifiedBlocks,
    unknown,
    complete: unknown.length === 0,
  };

  return {
    conversationId: convo.uuid,
    title: convo.name?.trim() || "Untitled conversation",
    capturedAt: opts.capturedAt,
    messages,
    artifacts,
    uploads: [...uploadsByName.values()],
    integrity,
  };
}
