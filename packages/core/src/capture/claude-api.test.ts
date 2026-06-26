import { describe, it, expect } from "vitest";
import {
  resolveOrgId,
  captureConversation,
  conversationIdFromUrl,
  CaptureError,
  type FetchLike,
} from "./claude-api.js";
import { mixedArtifactsConvo } from "../__fixtures__/conversations.js";

const AT = "2026-06-26T12:00:00Z";

/** Build a fake fetch that maps URL substrings to JSON responses or statuses. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>): FetchLike {
  // Match the MOST specific (longest) needle so "/chat_conversations/" wins over
  // "/organizations" for the conversation URL (which contains both).
  const ordered = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
  return async (url: string) => {
    for (const [needle, resp] of ordered) {
      if (url.includes(needle)) {
        const status = resp.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => resp.body,
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe("conversationIdFromUrl", () => {
  it("reads the id from a claude.ai chat url", () => {
    expect(
      conversationIdFromUrl("https://claude.ai/chat/abcd1234-5678-90ab-cdef-111122223333"),
    ).toBe("abcd1234-5678-90ab-cdef-111122223333");
  });
  it("returns null when there is no chat id", () => {
    expect(conversationIdFromUrl("https://claude.ai/")).toBeNull();
  });
});

describe("resolveOrgId", () => {
  it("prefers the org with the 'chat' capability", async () => {
    const f = fakeFetch({
      "/organizations": {
        body: [
          { uuid: "api-org", capabilities: ["api"] },
          { uuid: "chat-org", capabilities: ["chat", "api"] },
        ],
      },
    });
    expect(await resolveOrgId(f)).toBe("chat-org");
  });

  it("falls back to the first org when none advertise chat", async () => {
    const f = fakeFetch({ "/organizations": { body: [{ uuid: "only-org" }] } });
    expect(await resolveOrgId(f)).toBe("only-org");
  });

  it("throws a clear CaptureError on 401", async () => {
    const f = fakeFetch({ "/organizations": { status: 401 } });
    await expect(resolveOrgId(f)).rejects.toBeInstanceOf(CaptureError);
  });
});

describe("captureConversation end-to-end (fake network)", () => {
  it("resolves org, fetches, and normalizes into a complete transcript", async () => {
    const f = fakeFetch({
      "/organizations": { body: [{ uuid: "chat-org", capabilities: ["chat"] }] },
      "/chat_conversations/": { body: mixedArtifactsConvo },
    });
    const t = await captureConversation("conv-mixed-1", { fetchImpl: f, capturedAt: AT });
    expect(t.title).toBe("Build the upload handler");
    expect(t.artifacts).toHaveLength(3);
    expect(t.integrity.unknown).toHaveLength(1); // the mystery block, surfaced
  });
});
