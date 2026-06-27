/**
 * Perplexity data-layer client + normalizer.
 *
 * Perplexity uses the same shape as Claude: a clean cookie-authenticated REST
 * GET. No bearer token needed.
 *
 *   GET /rest/thread/{slug}   (credentials: include)
 *     -> { title, slug, chat_messages: [{ sender, text, ... }], ... }
 *
 * Reads the user's OWN thread only. `fetch` is injected for unit testing.
 *
 * Field names from reverse-engineering are slightly uncertain, so extraction is
 * defensive: text may be `text`/`content`/`answer`, sender may be `sender`/`role`.
 */

import type { NormalizedMessage, NormalizedTranscript, Role } from "../../../types.js";
import { CaptureError, type FetchLike } from "../../shared/http.js";

const DEFAULT_BASE = "https://www.perplexity.ai";

interface PplxMessage {
  sender?: string;
  role?: string;
  text?: string;
  content?: string;
  answer?: string;
  query?: string;
  [key: string]: unknown;
}
export interface PplxThread {
  title?: string;
  slug?: string;
  chat_messages?: PplxMessage[];
  entries?: PplxMessage[];
  [key: string]: unknown;
}

/** Read a Perplexity thread slug from a URL (/search/{slug}). */
export function perplexityThreadIdFromUrl(url: string): string | null {
  const m = url.match(/\/search\/([^/?#]+)/);
  return m?.[1] ?? null;
}

function role(m: PplxMessage): Role {
  const r = (m.sender ?? m.role ?? "").toLowerCase();
  return r === "user" || r === "human" ? "human" : "assistant";
}

function text(m: PplxMessage): string {
  const t = m.text ?? m.content ?? m.answer ?? m.query ?? "";
  return typeof t === "string" ? t.trim() : "";
}

/** Perplexity's source cards are separate arrays, not in the answer text. */
function sources(m: PplxMessage): string {
  const arrays = [m["search_results"], m["web_results"], m["sources"], m["citations"]];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr as Array<Record<string, unknown>>) {
      const url = typeof s === "string" ? s : (s?.["url"] ?? s?.["link"]);
      if (typeof url !== "string" || seen.has(url)) continue;
      seen.add(url);
      const title = typeof s === "object" ? (s["title"] ?? s["name"] ?? url) : url;
      lines.push(`- ${title}: ${url}`);
    }
  }
  return lines.length ? `\n\nSources:\n${lines.join("\n")}` : "";
}

export function normalizePerplexityThread(
  thread: PplxThread,
  opts: { capturedAt: string },
): NormalizedTranscript {
  const raw = thread.chat_messages ?? thread.entries ?? [];
  const messages: NormalizedMessage[] = [];
  for (const m of raw) {
    // A Perplexity "entry" can pack both the user query and the answer.
    const q = typeof m.query === "string" ? m.query.trim() : "";
    if (q) messages.push({ uuid: `pplx-${messages.length}`, role: "human", text: q });
    const body = text({ ...m, query: undefined }) + sources(m);
    if (body.trim()) messages.push({ uuid: `pplx-${messages.length}`, role: role(m), text: body });
  }
  return {
    conversationId: thread.slug ?? "perplexity",
    title: thread.title?.trim() || "Perplexity thread",
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

export interface CapturePerplexityOptions {
  fetchImpl: FetchLike;
  capturedAt: string;
  baseUrl?: string;
}

export async function capturePerplexityThread(
  slug: string,
  opts: CapturePerplexityOptions,
): Promise<NormalizedTranscript> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const res = await opts.fetchImpl(`${base}/rest/thread/${slug}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new CaptureError("Not signed in to Perplexity (" + res.status + ").");
    }
    throw new CaptureError(`Perplexity API returned ${res.status}.`);
  }
  const data = await res.json();
  if (!data || typeof data !== "object") {
    throw new CaptureError("Unexpected thread payload from Perplexity.");
  }
  return normalizePerplexityThread(data as PplxThread, { capturedAt: opts.capturedAt });
}
