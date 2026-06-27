/**
 * Grok (grok.com) data-layer client + normalizer.
 *
 * grok.com's own history is a clean cookie-authenticated REST GET (the
 * anti-bot signing only gates the message-SEND path, not reads):
 *
 *   GET /rest/app-chat/conversations/{id}/responses?includeThreads=true
 *     (credentials: include)
 *     -> { responses: [{ sender:"human"|"assistant", message, query, ... }] }
 *
 * Confirmed against the SaveMyContext and personal-ai-memory content scripts.
 */

import type { NormalizedMessage, NormalizedTranscript, Role } from "../../../types.js";
import { CaptureError, type FetchLike } from "../../shared/http.js";

const DEFAULT_BASE = "https://grok.com";

interface GrokResponse {
  sender?: string;
  message?: string;
  query?: string;
  isControl?: boolean;
  partial?: boolean;
  createTime?: string;
  [key: string]: unknown;
}

/** Read a Grok conversation id from a grok.com URL (/c/{id}). */
export function grokConversationIdFromUrl(url: string): string | null {
  const m = url.match(/\/c\/([0-9a-fA-F-]{8,})/);
  return m?.[1] ?? null;
}

export function normalizeGrok(
  raw: unknown,
  opts: { capturedAt: string },
): NormalizedTranscript {
  const r = raw as Record<string, unknown>;
  const responses = (Array.isArray(r?.["responses"]) ? r["responses"] : []) as GrokResponse[];

  // Order chronologically when timestamps are present.
  const ordered = [...responses].sort((a, b) => {
    const ta = a.createTime ? Date.parse(a.createTime.replace(/([^Z\d:.+-])$/, "$1")) : 0;
    const tb = b.createTime ? Date.parse(b.createTime ?? "") : 0;
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  });

  const messages: NormalizedMessage[] = [];
  for (const item of ordered) {
    if (item.isControl || item.partial) continue;
    const role: Role = (item.sender ?? "").toLowerCase() === "human" ? "human" : "assistant";
    const text =
      role === "human"
        ? (item.query ?? item.message ?? "")
        : (item.message ?? item.query ?? "");
    const t = typeof text === "string" ? text.trim() : "";
    if (t) messages.push({ uuid: `grok-${messages.length}`, role, text: t });
  }

  return {
    conversationId: "grok",
    title: typeof r?.["title"] === "string" ? (r["title"] as string).trim() || "Grok chat" : "Grok chat",
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

export interface CaptureGrokOptions {
  fetchImpl: FetchLike;
  capturedAt: string;
  baseUrl?: string;
}

export async function captureGrokConversation(
  id: string,
  opts: CaptureGrokOptions,
): Promise<NormalizedTranscript> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const res = await opts.fetchImpl(
    `${base}/rest/app-chat/conversations/${id}/responses?includeThreads=true`,
    { credentials: "include", headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new CaptureError("Not signed in to Grok (" + res.status + ").");
    }
    throw new CaptureError(`Grok API returned ${res.status}.`);
  }
  const t = normalizeGrok(await res.json(), { capturedAt: opts.capturedAt });
  if (t.messages.length === 0) throw new CaptureError("No Grok messages parsed.");
  return t;
}
