/**
 * Google Gemini (gemini.google.com) data-layer client + normalizer.
 *
 * Gemini has no clean JSON API. It uses Google's batchexecute RPC, which a
 * content script CAN replay because the tokens live on the page:
 *   - `at` token        = window.WIZ_global_data["SNlM0e"]
 *   - build label `bl`  = window.WIZ_global_data["cfb2h"]
 * The read-conversation RPC id is "hNvQHb". The response is Google's framed,
 * index-addressed array format (no field names), so parsing is positional and
 * version-fragile. If anything shifts, the adapter falls back to the screen
 * reader. EXPERIMENTAL by nature; the other adapters are far more stable.
 *
 * Verified against HanaokaYuzu/Gemini-API (chat_mixin.py, parsing.py).
 */

import type { Artifact, NormalizedMessage, NormalizedTranscript } from "../../../types.js";
import { CaptureError } from "../../shared/http.js";

const BATCH = "https://gemini.google.com/_/BardChatUi/data/batchexecute";
const READ_CHAT = "hNvQHb";

export interface GeminiTokens {
  at: string; // SNlM0e
  bl?: string; // cfb2h build label
  fsid?: string; // FdrFJe
  hl?: string; // TuX5cc language
}

interface PostResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}
export type PostFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    credentials: "include";
  },
) => Promise<PostResponse>;

/** Read a Gemini conversation id from a URL (gemini.google.com/app/{cid}). */
export function geminiConversationIdFromUrl(url: string): string | null {
  const m = url.match(/\/app\/([a-z0-9_-]{6,})/i);
  return m?.[1] ?? null;
}

/**
 * De-frame a batchexecute response and return the payload of the first frame
 * matching `rpcid`. The response starts with )]}' then length-prefixed lines;
 * we parse forgivingly by trying each line as JSON rather than counting bytes.
 */
export function extractRpcPayload(text: string, rpcid: string): unknown | null {
  const cleaned = text.replace(/^\)\]\}'/, "");
  for (const line of cleaned.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("[")) continue;
    let frames: unknown;
    try {
      frames = JSON.parse(t);
    } catch {
      continue;
    }
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      if (
        Array.isArray(frame) &&
        frame[0] === "wrb.fr" &&
        frame[1] === rpcid &&
        typeof frame[2] === "string"
      ) {
        try {
          return JSON.parse(frame[2]);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Model text is at candidate[1][0], unless it's a card_content URL → [22][0]. */
function candidateText(candidate: unknown[]): string {
  const primary = str((candidate?.[1] as unknown[])?.[0]);
  if (primary && !primary.startsWith("http://googleusercontent.com/card_content")) {
    return primary;
  }
  const card = str((candidate?.[22] as unknown[])?.[0]);
  return card || primary;
}

/**
 * The model candidates live at conv_turn[3][0] as a LIST (one entry per draft /
 * regeneration); each entry is [rcid, [text], ...]. Confirmed against a real
 * Gemini response: t[3] = [[[ "rc_…", ["…"] ]]], so the candidate is t[3][0][0],
 * not t[3][0]. Pick the first draft that actually carries text.
 */
function pickCandidate(turn: unknown[]): unknown[] {
  const candidates = (turn?.[3] as unknown[])?.[0];
  if (!Array.isArray(candidates)) return [];
  for (const c of candidates) {
    if (Array.isArray(c) && candidateText(c)) return c;
  }
  return (Array.isArray(candidates[0]) ? candidates[0] : []) as unknown[];
}

/** The longest string anywhere inside a value (for the canvas doc at [30]). */
function deepLongestString(v: unknown): string {
  let best = "";
  const walk = (x: unknown): void => {
    if (typeof x === "string") {
      if (x.length > best.length) best = x;
    } else if (Array.isArray(x)) {
      for (const e of x) walk(e);
    }
  };
  walk(v);
  return best;
}

/**
 * Canvas / "Immersive" document body lives at candidate[30] (a nested array the
 * library never parses). We pull the document text out best-effort so its tables
 * and code are not lost. Returns the doc text, or "".
 */
function canvasDoc(candidate: unknown[]): string {
  const block = candidate?.[30];
  if (!block) return "";
  const text = deepLongestString(block);
  return text.length > 60 ? text.trim() : "";
}

/**
 * Parse the read-chat payload into messages. Positional access (no field names).
 * Turns come newest-first from the server, so we reverse to chronological order.
 */
export function normalizeGeminiPayload(
  payload: unknown,
  opts: { capturedAt: string },
): NormalizedTranscript {
  const messages: NormalizedMessage[] = [];
  const artifacts: Artifact[] = [];
  const turns = (payload as unknown[])?.[0];
  if (Array.isArray(turns)) {
    for (const turn of [...turns].reverse()) {
      const t = turn as unknown[];
      // user message text -> conv_turn[2][0][0]
      const userText = str((((t?.[2] as unknown[])?.[0]) as unknown[])?.[0]);
      if (userText) messages.push({ uuid: `gm-${messages.length}`, role: "human", text: userText });
      // model candidate -> conv_turn[3][0][0]; text -> candidate[1][0] (or [22][0])
      const candidate = pickCandidate(t);
      const modelText = candidateText(candidate);
      if (modelText) messages.push({ uuid: `gm-${messages.length}`, role: "assistant", text: modelText });
      // canvas / immersive document body -> candidate[30]
      const doc = canvasDoc(candidate);
      if (doc) {
        artifacts.push({
          id: `artifact-${artifacts.length + 1}`,
          filename: `gemini-canvas-${artifacts.length + 1}.md`,
          content: doc,
          format: "tool_use",
          messageUuid: "gemini-canvas",
          presented: true,
        });
      }
    }
  }
  return {
    conversationId: "gemini",
    title: "Gemini conversation",
    capturedAt: opts.capturedAt,
    messages,
    artifacts,
    uploads: [],
    integrity: {
      totalBlocks: messages.length + artifacts.length,
      classifiedBlocks: messages.length + artifacts.length,
      unknown: [],
      complete: true,
    },
  };
}

export interface CaptureGeminiOptions {
  post: PostFetch;
  tokens: GeminiTokens;
  capturedAt: string;
  /** Pseudo-random request id; injected so core stays deterministic in tests. */
  reqid?: number;
}

export async function captureGeminiConversation(
  conversationId: string,
  opts: CaptureGeminiOptions,
): Promise<NormalizedTranscript> {
  // The read RPC needs the c_-prefixed id; the URL gives the bare segment.
  const cid = conversationId.startsWith("c_") ? conversationId : `c_${conversationId}`;
  const inner = JSON.stringify([cid, 1000, null, 1, [1], [4], null, 1]);
  const fReq = JSON.stringify([[[READ_CHAT, inner, null, "generic"]]]);
  const params = new URLSearchParams({
    rpcids: READ_CHAT,
    "source-path": "/app",
    ...(opts.tokens.hl ? { hl: opts.tokens.hl } : {}),
    _reqid: String(opts.reqid ?? 100000),
    rt: "c",
  });
  const body = new URLSearchParams({ "f.req": fReq, at: opts.tokens.at }).toString();

  // Minimal header set, matching the in-browser exporter that works. The jspb
  // and bl headers are only needed for sends, not reads.
  const res = await opts.post(`${BATCH}?${params.toString()}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "x-same-domain": "1",
    },
    body,
  });
  if (!res.ok) throw new CaptureError(`Gemini RPC returned ${res.status}.`);
  const payload = extractRpcPayload(await res.text(), READ_CHAT);
  if (!payload) throw new CaptureError("Gemini response shape not recognized.");
  const t = normalizeGeminiPayload(payload, { capturedAt: opts.capturedAt });
  if (t.messages.length === 0) throw new CaptureError("No Gemini messages parsed.");
  return t;
}
