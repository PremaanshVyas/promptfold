/**
 * ChatGPT data-layer client + normalizer.
 *
 * Runs from a content script on chatgpt.com. Unlike Claude (cookie auth), ChatGPT
 * needs a short-lived bearer token fetched from its session endpoint:
 *
 *   GET /api/auth/session                       -> { accessToken }
 *   GET /backend-api/conversation/{id}          -> { mapping, current_node, ... }
 *     headers: Authorization: Bearer <token>, credentials: include
 *
 * The conversation is a TREE (mapping of nodes); we walk from current_node up to
 * the root to recover the selected branch in order. Canvas documents live inside
 * `canmore.*` assistant nodes and are replayed (create + updates) into artifacts.
 *
 * Reading the user's OWN conversation only. Never routes the session for
 * inference. `fetch` is injected so this is unit-testable without a browser.
 */

import type { Artifact, NormalizedMessage, NormalizedTranscript, Role } from "../types.js";
import { CaptureError, type FetchLike } from "./claude-api.js";

// ── on-wire shapes (only the subset we use) ────────────────────────────────
interface GptContent {
  content_type?: string;
  parts?: unknown[];
  text?: string;
}
interface GptMessage {
  id?: string;
  author?: { role?: string };
  content?: GptContent;
  recipient?: string;
  create_time?: number | null;
  metadata?: {
    is_visually_hidden_from_conversation?: boolean;
    canvas?: { textdoc_id?: string; textdoc_type?: string; title?: string };
    content_references?: Array<{ items?: Array<{ title?: string; url?: string }> }>;
    citations?: Array<{ metadata?: { title?: string; url?: string } }>;
  };
}
interface GptNode {
  id?: string;
  message?: GptMessage | null;
  parent?: string | null;
  children?: string[];
}
export interface GptConversation {
  title?: string;
  conversation_id?: string;
  current_node?: string;
  mapping?: Record<string, GptNode>;
}

const DEFAULT_BASE = "https://chatgpt.com";

// ── auth + fetch ───────────────────────────────────────────────────────────

interface GptSession {
  accessToken?: string;
}

async function getAccessToken(fetchImpl: FetchLike, base: string): Promise<string> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${base}/api/auth/session`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new CaptureError("Network error reaching ChatGPT session.", err);
  }
  if (!res.ok) {
    throw new CaptureError(
      "Not signed in to ChatGPT (session " + res.status + "). Open and log in to chatgpt.com.",
    );
  }
  const session = (await res.json()) as GptSession;
  if (!session?.accessToken) {
    throw new CaptureError("ChatGPT session has no access token (are you logged in?).");
  }
  return session.accessToken;
}

export async function fetchChatGptConversation(
  fetchImpl: FetchLike,
  conversationId: string,
  token: string,
  base: string = DEFAULT_BASE,
): Promise<GptConversation> {
  const res = await fetchImpl(`${base}/backend-api/conversation/${conversationId}`, {
    credentials: "include",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new CaptureError(
        "ChatGPT denied the read (" + res.status + "). Reload the chatgpt.com tab and try again.",
      );
    }
    throw new CaptureError(`ChatGPT API returned ${res.status}.`);
  }
  const data = await res.json();
  if (!data || typeof data !== "object") {
    throw new CaptureError("Unexpected conversation payload from ChatGPT.");
  }
  return data as GptConversation;
}

/** Read a ChatGPT conversation id from a URL. Handles /c/, project, and GPT URLs. */
export function chatGptConversationIdFromUrl(url: string): string | null {
  const m = url.match(/\/c\/([0-9a-fA-F-]{36})/);
  return m?.[1] ?? null;
}

// ── normalize ──────────────────────────────────────────────────────────────

function toRole(role: string | undefined): Role {
  return role === "user" ? "human" : "assistant";
}

/** Walk current_node -> root via parent, returns nodes oldest-first. */
export function linearBranch(convo: GptConversation): GptNode[] {
  const mapping = convo.mapping ?? {};
  let cursor: string | null | undefined = convo.current_node;

  // Fallback: no current_node -> order all message-bearing nodes by time.
  if (!cursor || !mapping[cursor]) {
    return Object.values(mapping)
      .filter((n) => n.message)
      .sort((a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0));
  }

  const chain: GptNode[] = [];
  const seen = new Set<string>();
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    const node: GptNode = mapping[cursor]!;
    chain.unshift(node);
    cursor = node.parent ?? null;
  }
  return chain;
}

function extractText(content: GptContent | undefined): string {
  if (!content) return "";
  const ct = content.content_type;
  if ((ct === "text" || ct === "multimodal_text") && Array.isArray(content.parts)) {
    return content.parts
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
  }
  if (ct === "text" && typeof content.text === "string") return content.text.trim();
  return "";
}

function isCanvasNode(msg: GptMessage): boolean {
  return typeof msg.recipient === "string" && msg.recipient.startsWith("canmore.");
}

const CANVAS_EXT: Record<string, string> = {
  document: "md",
  "code/python": "py",
  "code/javascript": "js",
  "code/typescript": "ts",
  "code/html": "html",
  "code/react": "jsx",
  "code/css": "css",
  "code/sql": "sql",
};

function canvasFilename(name: string, type: string | undefined): string {
  if (/\.[a-z0-9]+$/i.test(name)) return name;
  const ext = (type && CANVAS_EXT[type]) || (type?.startsWith("code/") ? "txt" : "md");
  return `${name}.${ext}`;
}

interface Doc {
  name: string;
  type?: string;
  content: string;
}

/** Apply a canmore node (create/update) onto the running doc set. */
function applyCanvasNode(docs: Map<string, Doc>, msg: GptMessage): void {
  const recipient = msg.recipient ?? "";
  const id = msg.metadata?.canvas?.textdoc_id ?? "default";
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(msg.content?.text ?? "{}") as Record<string, unknown>;
  } catch {
    return;
  }

  if (recipient.includes("create_textdoc")) {
    const name = typeof payload["name"] === "string" ? (payload["name"] as string) : "canvas";
    const content = typeof payload["content"] === "string" ? (payload["content"] as string) : "";
    const type = (payload["type"] as string) ?? msg.metadata?.canvas?.textdoc_type;
    docs.set(id, { name, content, ...(type ? { type } : {}) });
  } else if (recipient.includes("update_textdoc")) {
    const doc = docs.get(id);
    if (!doc) return;
    const updates = Array.isArray(payload["updates"]) ? payload["updates"] : [];
    for (const u of updates as Array<Record<string, unknown>>) {
      const pattern = u["pattern"];
      const replacement = u["replacement"];
      if (typeof pattern === "string" && typeof replacement === "string") {
        try {
          const re = new RegExp(pattern, u["multiple"] ? "g" : "");
          doc.content = doc.content.replace(re, replacement);
        } catch {
          // Bad regex from the wire: skip this edit rather than crash.
        }
      }
    }
  }
  // comment_textdoc and others: ignored.
}

/** Source/citation cards live in metadata, not the answer text. Append them. */
function sourcesOf(msg: GptMessage): string {
  const out = new Map<string, string>(); // url -> title
  for (const ref of msg.metadata?.content_references ?? []) {
    for (const it of ref.items ?? []) {
      if (it.url) out.set(it.url, it.title ?? it.url);
    }
  }
  for (const c of msg.metadata?.citations ?? []) {
    const u = c.metadata?.url;
    if (u) out.set(u, c.metadata?.title ?? u);
  }
  if (out.size === 0) return "";
  const lines = [...out].map(([url, title]) => `- ${title}: ${url}`);
  return `\n\nSources:\n${lines.join("\n")}`;
}

export interface NormalizeChatGptOptions {
  capturedAt: string;
}

export function normalizeChatGptConversation(
  convo: GptConversation,
  opts: NormalizeChatGptOptions,
): NormalizedTranscript {
  const nodes = linearBranch(convo);
  const messages: NormalizedMessage[] = [];
  const docs = new Map<string, Doc>();

  for (const node of nodes) {
    const msg = node.message;
    if (!msg) continue;
    if (msg.metadata?.is_visually_hidden_from_conversation) continue;
    const role = msg.author?.role;
    if (role === "system") continue;

    if (isCanvasNode(msg)) {
      applyCanvasNode(docs, msg);
      continue;
    }

    // Only visible user/assistant prose (recipient "all" or unset).
    if ((role === "user" || role === "assistant") && (msg.recipient ?? "all") === "all") {
      const text = extractText(msg.content) + sourcesOf(msg);
      if (text.trim().length > 0) {
        messages.push({
          uuid: msg.id ?? node.id ?? `gpt-${messages.length}`,
          role: toRole(role),
          text,
        });
      }
    }
    // tool nodes (python/browser/dalle) are plumbing -> dropped.
  }

  let counter = 0;
  const artifacts: Artifact[] = [...docs.values()].map((d) => ({
    id: `artifact-${++counter}`,
    filename: canvasFilename(d.name, d.type),
    content: d.content,
    format: "tool_use",
    messageUuid: "chatgpt-canvas",
    presented: true,
    ...(d.type ? { language: d.type } : {}),
  }));

  return {
    conversationId: convo.conversation_id ?? "chatgpt",
    title: convo.title?.trim() || "ChatGPT conversation",
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

export interface CaptureChatGptOptions {
  fetchImpl: FetchLike;
  capturedAt: string;
  /** Origin to call (defaults to chatgpt.com; pass location.origin on the page). */
  baseUrl?: string;
}

/** End-to-end: token -> conversation -> normalized transcript. */
export async function captureChatGptConversation(
  conversationId: string,
  opts: CaptureChatGptOptions,
): Promise<NormalizedTranscript> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const token = await getAccessToken(opts.fetchImpl, base);
  const convo = await fetchChatGptConversation(opts.fetchImpl, conversationId, token, base);
  return normalizeChatGptConversation(convo, { capturedAt: opts.capturedAt });
}
