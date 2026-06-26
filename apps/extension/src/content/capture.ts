/**
 * Capture adapters. This is what makes carrybot NOT hardcoded to one platform.
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
  transcriptFromMessages,
  type FetchLike,
  type NormalizedTranscript,
  type SimpleMessage,
} from "@carrybot/core";

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
      throw new Error("Open a Claude conversation first, then click Carry.");
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
        "carrybot could not find a conversation on this page. It works best on " +
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

const ADAPTERS: CaptureAdapter[] = [claudeAdapter /* add precise adapters here */];

export function pickAdapter(hostname: string): CaptureAdapter {
  return ADAPTERS.find((a) => a.matches(hostname)) ?? genericDomAdapter;
}
