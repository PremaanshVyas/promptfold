/**
 * DeepSeek data-layer client + normalizer.
 *
 * Same pattern as ChatGPT: a bearer token (DeepSeek keeps it in localStorage,
 * which the content-script adapter reads and passes in), then a REST GET.
 *
 *   GET /api/v0/chat/history_messages?chat_session_id={id}
 *     headers: Authorization: Bearer <token>
 *     -> { code, data: { biz_data: { chat_messages: [{ role, content, ... }] } } }
 *
 * Response field locations are from reverse-engineering and slightly uncertain,
 * so extraction is defensive. If it doesn't match, the adapter falls back to the
 * screen reader.
 */

import type { NormalizedMessage, NormalizedTranscript, Role } from "../../../types.js";
import { CaptureError, type FetchLike } from "../../shared/http.js";

const DEFAULT_BASE = "https://chat.deepseek.com";

interface DsMessage {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

/** Read a DeepSeek session id from a URL (/a/chat/s/{id} or /s/{id}). */
export function deepseekSessionIdFromUrl(url: string): string | null {
  const m = url.match(/\/s\/([0-9a-fA-F-]{8,})/);
  return m?.[1] ?? null;
}

function toRole(r: unknown): Role {
  const s = typeof r === "string" ? r.toLowerCase() : "";
  return s === "user" || s === "human" ? "human" : "assistant";
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content && typeof content === "object") {
    const o = content as Record<string, unknown>;
    if (typeof o["text"] === "string") return (o["text"] as string).trim();
  }
  return "";
}

/** Probe the (uncertain) response shape for the messages array. */
function findMessages(raw: unknown): DsMessage[] {
  const r = raw as Record<string, unknown>;
  const data = (r?.["data"] ?? r) as Record<string, unknown>;
  const biz = (data?.["biz_data"] ?? data) as Record<string, unknown>;
  const candidates = [biz?.["chat_messages"], biz?.["messages"], data?.["messages"]];
  for (const c of candidates) if (Array.isArray(c)) return c as DsMessage[];
  return [];
}

export function normalizeDeepSeek(
  raw: unknown,
  opts: { capturedAt: string; title?: string },
): NormalizedTranscript {
  const messages: NormalizedMessage[] = [];
  for (const m of findMessages(raw)) {
    const text = textOf(m.content);
    if (text) messages.push({ uuid: `ds-${messages.length}`, role: toRole(m.role), text });
  }
  return {
    conversationId: "deepseek",
    title: opts.title?.trim() || "DeepSeek chat",
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

export interface CaptureDeepSeekOptions {
  fetchImpl: FetchLike;
  /** Bearer token read from the page's localStorage by the adapter. */
  token: string;
  capturedAt: string;
  baseUrl?: string;
}

export async function captureDeepSeekConversation(
  sessionId: string,
  opts: CaptureDeepSeekOptions,
): Promise<NormalizedTranscript> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const res = await opts.fetchImpl(
    `${base}/api/v0/chat/history_messages?chat_session_id=${sessionId}`,
    { credentials: "include", headers: { Accept: "application/json", Authorization: `Bearer ${opts.token}` } },
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new CaptureError("Not signed in to DeepSeek (" + res.status + ").");
    }
    throw new CaptureError(`DeepSeek API returned ${res.status}.`);
  }
  const data = await res.json();
  const t = normalizeDeepSeek(data, { capturedAt: opts.capturedAt });
  if (t.messages.length === 0) {
    throw new CaptureError("DeepSeek response shape not recognized.");
  }
  return t;
}
