/**
 * HuggingFace Chat (chat-ui) data-layer client + normalizer.
 *
 * chat-ui exposes a clean cookie-authenticated JSON route, so this is the same
 * pattern as Claude/Perplexity:
 *
 *   GET /chat/api/conversation/{id}   (credentials: include)
 *     -> { title, messages: [{ from: "user"|"assistant"|"system", content }] }
 *
 * Falls back across the known route variants (the v2 route returns superjson
 * {"json":{messages}}, which we read without a superjson lib). The {id} is the
 * 24-char Mongo ObjectId in the URL; a 7-char id is a share link (skipped).
 */

import type { NormalizedMessage, NormalizedTranscript, Role } from "../types.js";
import { CaptureError, type FetchLike } from "./shared/http.js";

interface HfMessage {
  from?: string;
  content?: string;
  [key: string]: unknown;
}

/** Read a HuggingFace Chat conversation id (24-char ObjectId) from a URL. */
export function hfConversationIdFromUrl(url: string): string | null {
  const m = url.match(/\/conversation\/([0-9a-fA-F]{24})/);
  return m?.[1] ?? null;
}

function toRole(from: string | undefined): Role {
  return from === "user" ? "human" : "assistant";
}

export function normalizeHfConversation(
  raw: unknown,
  opts: { capturedAt: string },
): NormalizedTranscript {
  const r = raw as Record<string, unknown>;
  // Plain route returns {messages}; the v2 superjson route nests under .json.
  const body = (r?.["json"] ?? r) as Record<string, unknown>;
  const rawMsgs = Array.isArray(body?.["messages"]) ? (body["messages"] as HfMessage[]) : [];
  const messages: NormalizedMessage[] = [];
  for (const m of rawMsgs) {
    if (m.from === "system") continue;
    const text = typeof m.content === "string" ? m.content.trim() : "";
    if (text) messages.push({ uuid: `hf-${messages.length}`, role: toRole(m.from), text });
  }
  return {
    conversationId: "huggingface-chat",
    title: typeof body?.["title"] === "string" ? (body["title"] as string).trim() || "HuggingFace chat" : "HuggingFace chat",
    capturedAt: opts.capturedAt,
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

export interface CaptureHfOptions {
  fetchImpl: FetchLike;
  capturedAt: string;
  /** Page origin (defaults to huggingface.co). Self-hosted forks differ. */
  baseUrl?: string;
  /** Base path before /api (chat-ui is "/chat" on huggingface.co, "" on forks). */
  basePath?: string;
}

export async function captureHfConversation(
  id: string,
  opts: CaptureHfOptions,
): Promise<NormalizedTranscript> {
  const base = (opts.baseUrl ?? "https://huggingface.co") + (opts.basePath ?? "/chat");
  const candidates = [
    `${base}/api/conversation/${id}`,
    `${base}/api/v2/conversations/${id}`,
  ];
  let lastStatus = 0;
  for (const url of candidates) {
    const res = await opts.fetchImpl(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      lastStatus = res.status;
      continue;
    }
    const t = normalizeHfConversation(await res.json(), { capturedAt: opts.capturedAt });
    if (t.messages.length > 0) return t;
  }
  throw new CaptureError(
    lastStatus === 401 || lastStatus === 403
      ? "Not signed in to HuggingFace."
      : "Could not read this HuggingFace conversation.",
  );
}
