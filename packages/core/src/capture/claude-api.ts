/**
 * Claude data-layer client.
 *
 * Runs inside a content script on claude.ai, where same-origin fetch with
 * `credentials: "include"` carries the user's session cookie automatically.
 * No CSRF token, no CORS. This reads the user's OWN conversation, the same
 * request the page makes to render it.
 *
 * IMPORTANT (ToS / risk): this client never routes the Claude session for
 * inference. It reads chat data only. Fetch on demand, one conversation per
 * user action, never bulk-loop.
 *
 * `fetch` is injected so the logic is unit-testable without a browser.
 */

import type {
  ClaudeConversation,
  ClaudeOrg,
  NormalizedTranscript,
} from "../types.js";
import { normalizeConversation } from "./normalize.js";
import { CaptureError, type FetchLike } from "./shared/http.js";

// Re-export so existing importers keep working during/after the reorg.
export { CaptureError, type FetchLike };

const BASE = "https://claude.ai/api";

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new CaptureError(`Network error fetching ${url}`, err);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new CaptureError(
        "Not signed in to Claude (got " +
          res.status +
          "). Open and log in to claude.ai, then try again.",
      );
    }
    throw new CaptureError(`Claude API returned ${res.status} for ${url}`);
  }
  return res.json();
}

/** Resolve the organization that owns the user's chats. */
export async function resolveOrgId(fetchImpl: FetchLike): Promise<string> {
  const data = await getJson(fetchImpl, `${BASE}/organizations`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new CaptureError("No Claude organizations found for this account.");
  }
  const orgs = data as ClaudeOrg[];
  // Prefer the org with the "chat" capability; API-only orgs lack it and 404.
  const chatOrg = orgs.find(
    (o) => Array.isArray(o.capabilities) && o.capabilities.includes("chat"),
  );
  const chosen = chatOrg ?? orgs[0];
  if (!chosen?.uuid) {
    throw new CaptureError("Could not determine Claude organization id.");
  }
  return chosen.uuid;
}

/** Fetch one full conversation (message tree + all tool/artifact blocks). */
export async function fetchConversation(
  fetchImpl: FetchLike,
  orgId: string,
  conversationId: string,
): Promise<ClaudeConversation> {
  const url =
    `${BASE}/organizations/${orgId}/chat_conversations/${conversationId}` +
    `?tree=True&rendering_mode=messages&render_all_tools=true`;
  const data = await getJson(fetchImpl, url);
  if (!data || typeof data !== "object") {
    throw new CaptureError("Unexpected conversation payload from Claude.");
  }
  return data as ClaudeConversation;
}

/** Read a conversation id out of a claude.ai chat URL. */
export function conversationIdFromUrl(url: string): string | null {
  const m = url.match(/\/chat\/([0-9a-fA-F-]{8,})/);
  return m?.[1] ?? null;
}

export interface CaptureOptions {
  fetchImpl: FetchLike;
  /** ISO timestamp from the caller (core stays pure, no Date.now here). */
  capturedAt: string;
  /** Optional pre-resolved org id to skip the extra round-trip. */
  orgId?: string;
}

/**
 * End-to-end capture: resolve org → fetch conversation → normalize.
 * Returns a complete, integrity-checked transcript.
 */
export async function captureConversation(
  conversationId: string,
  opts: CaptureOptions,
): Promise<NormalizedTranscript> {
  const orgId = opts.orgId ?? (await resolveOrgId(opts.fetchImpl));
  const convo = await fetchConversation(opts.fetchImpl, orgId, conversationId);
  return normalizeConversation(convo, { capturedAt: opts.capturedAt });
}
