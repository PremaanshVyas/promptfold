/**
 * Capture adapters. This is what makes PromptFold NOT hardcoded to one platform.
 *
 *   pickAdapter(hostname) -> the best adapter for the current site
 *     claude.ai      -> ClaudeAdapter   (reads the data layer; perfect, artifacts)
 *     anything else  -> GenericDomAdapter (reads the visible messages; lower
 *                       fidelity, honest about it)
 *
 * Adding a new precise platform later = add one adapter to the list. Until then
 * any chat UI still produces a brief via the DOM fallback.
 */

import {
  captureConversation,
  conversationIdFromUrl,
  captureChatGptConversation,
  chatGptConversationIdFromUrl,
  capturePerplexityThread,
  perplexityThreadIdFromUrl,
  captureDeepSeekConversation,
  deepseekSessionIdFromUrl,
  captureGrokConversation,
  grokConversationIdFromUrl,
  captureHfConversation,
  hfConversationIdFromUrl,
  captureGeminiConversation,
  geminiConversationIdFromUrl,
  transcriptFromMessages,
  type FetchLike,
  type GeminiTokens,
  type NormalizedTranscript,
  type PostFetch,
  type SimpleMessage,
} from "@promptfold/core";

export type CaptureSource = "data layer" | "screen";

export interface CaptureAdapter {
  id: string;
  /** Shown in the brief so the user knows how complete the capture is. */
  source: CaptureSource;
  matches(hostname: string): boolean;
  /** Returns a transcript, or throws with a human-readable reason. */
  capture(capturedAt: string): Promise<NormalizedTranscript>;
}

const fetchImpl: FetchLike = (url, init) => fetch(url, init as RequestInit);

// ── Claude: the precise, data-layer adapter ────────────────────────────────
const claudeAdapter: CaptureAdapter = {
  id: "claude",
  source: "data layer",
  matches: (h) => h === "claude.ai" || h.endsWith(".claude.ai"),
  async capture(capturedAt) {
    const convoId = conversationIdFromUrl(location.href);
    if (!convoId) {
      throw new Error("Open a Claude conversation first, then click Fold.");
    }
    return captureConversation(convoId, { fetchImpl, capturedAt });
  },
};

// ── Generic DOM fallback: works on any chat UI ─────────────────────────────

/** Heuristics to pull {role, text} messages out of an arbitrary chat page. */
function extractDomMessages(): SimpleMessage[] {
  // Strategy 1: explicit author-role attributes (ChatGPT and several others).
  const roled = Array.from(
    document.querySelectorAll<HTMLElement>("[data-message-author-role]"),
  );
  if (roled.length >= 2) {
    return roled.map((el) => ({
      role: el.getAttribute("data-message-author-role") === "user" ? "human" : "assistant",
      text: el.innerText ?? "",
    }));
  }

  // Strategy 2: common per-message containers, with role guessed by alternation.
  const SELECTORS = [
    "[data-testid*='message']",
    "[class*='message']",
    "article",
    "[role='listitem']",
  ];
  for (const sel of SELECTORS) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
      (n) => (n.innerText ?? "").trim().length > 20,
    );
    if (nodes.length >= 2) {
      return nodes.map((n, i) => ({
        role: guessRole(n, i),
        text: n.innerText ?? "",
      }));
    }
  }

  return [];
}

/** Best-effort role: look for a role hint, else alternate (user first). */
function guessRole(el: HTMLElement, index: number): SimpleMessage["role"] {
  const hint = (
    el.getAttribute("data-role") ??
    el.className ??
    ""
  ).toLowerCase();
  if (/user|human|you\b/.test(hint)) return "human";
  if (/assistant|bot|ai|model|response/.test(hint)) return "assistant";
  return index % 2 === 0 ? "human" : "assistant";
}

const genericDomAdapter: CaptureAdapter = {
  id: "generic-dom",
  source: "screen",
  matches: () => true, // last-resort fallback
  async capture(capturedAt) {
    const msgs = extractDomMessages();
    if (msgs.length < 2) {
      throw new Error(
        "PromptFold could not find a conversation on this page. It works best on " +
          "supported chatbots; this site may use a layout it can't read yet.",
      );
    }
    return transcriptFromMessages(msgs, {
      conversationId: location.pathname || location.href,
      title: document.title || "Conversation",
      capturedAt,
    });
  },
};

// ── ChatGPT: precise, data-layer adapter ───────────────────────────────────
const chatgptAdapter: CaptureAdapter = {
  id: "chatgpt",
  source: "data layer",
  matches: (h) =>
    h === "chatgpt.com" || h === "chat.openai.com" || h.endsWith(".chatgpt.com"),
  async capture(capturedAt) {
    const convoId = chatGptConversationIdFromUrl(location.href);
    if (!convoId) {
      throw new Error(
        "Open a saved ChatGPT conversation first (temporary chats can't be read).",
      );
    }
    return captureChatGptConversation(convoId, {
      fetchImpl,
      capturedAt,
      baseUrl: location.origin,
    });
  },
};

// ── Perplexity: precise, cookie-REST adapter (same shape as Claude) ─────────
const perplexityAdapter: CaptureAdapter = {
  id: "perplexity",
  source: "data layer",
  matches: (h) => h === "perplexity.ai" || h.endsWith(".perplexity.ai"),
  async capture(capturedAt) {
    const slug = perplexityThreadIdFromUrl(location.href);
    if (!slug) throw new Error("Open a Perplexity thread first, then click Fold.");
    return capturePerplexityThread(slug, { fetchImpl, capturedAt, baseUrl: location.origin });
  },
};

// ── DeepSeek: bearer-from-localStorage REST adapter (like ChatGPT) ──────────
function readDeepSeekToken(): string {
  try {
    const raw = localStorage.getItem("userToken");
    if (!raw) return "";
    return (JSON.parse(raw) as { value?: string }).value ?? "";
  } catch {
    return "";
  }
}

const deepseekAdapter: CaptureAdapter = {
  id: "deepseek",
  source: "data layer",
  matches: (h) => h === "chat.deepseek.com" || h.endsWith(".deepseek.com"),
  async capture(capturedAt) {
    const id = deepseekSessionIdFromUrl(location.href);
    if (!id) throw new Error("Open a DeepSeek chat first, then click Fold.");
    const token = readDeepSeekToken();
    if (!token) throw new Error("Could not find your DeepSeek session (are you signed in?).");
    return captureDeepSeekConversation(id, { fetchImpl, token, capturedAt, baseUrl: location.origin });
  },
};

// ── Grok: cookie-REST adapter (grok.com) ────────────────────────────────────
const grokAdapter: CaptureAdapter = {
  id: "grok",
  source: "data layer",
  matches: (h) => h === "grok.com" || h.endsWith(".grok.com"),
  async capture(capturedAt) {
    const id = grokConversationIdFromUrl(location.href);
    if (!id) throw new Error("Open a Grok conversation first, then click Fold.");
    return captureGrokConversation(id, { fetchImpl, capturedAt, baseUrl: location.origin });
  },
};

// ── HuggingFace Chat: cookie-REST adapter ───────────────────────────────────
const hfAdapter: CaptureAdapter = {
  id: "huggingface",
  source: "data layer",
  matches: (h) => h === "huggingface.co" || h.endsWith(".huggingface.co"),
  async capture(capturedAt) {
    const id = hfConversationIdFromUrl(location.href);
    if (!id) throw new Error("Open a HuggingFace chat first, then click Fold.");
    // chat-ui is under /chat on huggingface.co; self-hosted forks use no prefix.
    const basePath = location.hostname === "huggingface.co" ? "/chat" : "";
    return captureHfConversation(id, { fetchImpl, capturedAt, baseUrl: location.origin, basePath });
  },
};

// ── Gemini: batchexecute RPC adapter (experimental) ─────────────────────────
const postFetch: PostFetch = (url, init) => fetch(url, init as RequestInit);

/** Read Gemini's page tokens out of the inline WIZ_global_data script. */
function geminiTokens(): GeminiTokens | null {
  const html = document.documentElement.innerHTML;
  const at = html.match(/"SNlM0e":\s*"(.*?)"/)?.[1];
  if (!at) return null;
  return {
    at,
    ...(html.match(/"cfb2h":\s*"(.*?)"/)?.[1] ? { bl: html.match(/"cfb2h":\s*"(.*?)"/)![1] } : {}),
    ...(html.match(/"FdrFJe":\s*"(.*?)"/)?.[1] ? { fsid: html.match(/"FdrFJe":\s*"(.*?)"/)![1] } : {}),
    ...(html.match(/"TuX5cc":\s*"(.*?)"/)?.[1] ? { hl: html.match(/"TuX5cc":\s*"(.*?)"/)![1] } : {}),
  };
}

const geminiAdapter: CaptureAdapter = {
  id: "gemini",
  source: "data layer",
  matches: (h) => h === "gemini.google.com",
  async capture(capturedAt) {
    const cid = geminiConversationIdFromUrl(location.href);
    if (!cid) throw new Error("Open a saved Gemini conversation first, then click Fold.");
    const tokens = geminiTokens();
    if (!tokens) throw new Error("Could not read Gemini session tokens from the page.");
    return captureGeminiConversation(cid, {
      post: postFetch,
      tokens,
      capturedAt,
      reqid: 100000 + Math.floor(Math.random() * 900000),
    });
  },
};

const ADAPTERS: CaptureAdapter[] = [
  claudeAdapter,
  chatgptAdapter,
  perplexityAdapter,
  deepseekAdapter,
  grokAdapter,
  hfAdapter,
  geminiAdapter,
  /* add precise adapters here */
];

export function pickAdapter(hostname: string): CaptureAdapter {
  return ADAPTERS.find((a) => a.matches(hostname)) ?? genericDomAdapter;
}

/**
 * Capture for the current page. Picks the best adapter; if a data-layer adapter
 * fails (shape drift, auth, an unsupported page), falls back to the screen
 * reader so the site still produces a brief instead of erroring.
 */
export async function runCapture(
  capturedAt: string,
): Promise<{ transcript: NormalizedTranscript; source: CaptureSource }> {
  const adapter = pickAdapter(location.hostname);
  try {
    return { transcript: await adapter.capture(capturedAt), source: adapter.source };
  } catch (err) {
    if (adapter.source === "data layer") {
      try {
        return { transcript: await genericDomAdapter.capture(capturedAt), source: "screen" };
      } catch {
        // The screen reader also found nothing; surface the more specific error.
      }
    }
    throw err;
  }
}
