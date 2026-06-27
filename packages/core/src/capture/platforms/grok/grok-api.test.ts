import { describe, it, expect } from "vitest";
import {
  normalizeGrok,
  grokConversationIdFromUrl,
  captureGrokConversation,
} from "./grok-api.js";
import type { FetchLike } from "../../shared/http.js";

const AT = "2026-06-27T00:00:00Z";

describe("grokConversationIdFromUrl", () => {
  it("reads /c/{id}", () => {
    expect(grokConversationIdFromUrl("https://grok.com/c/abcd1234-5678-90ab")).toBe(
      "abcd1234-5678-90ab",
    );
  });
});

describe("normalizeGrok", () => {
  it("maps human/assistant and prefers query for user turns", () => {
    const t = normalizeGrok(
      {
        responses: [
          { sender: "human", query: "what is BSB?", message: "" },
          { sender: "assistant", message: "Bank-State-Branch code" },
          { sender: "assistant", message: "x", isControl: true },
          { sender: "assistant", message: "y", partial: true },
        ],
      },
      { capturedAt: AT },
    );
    expect(t.messages).toHaveLength(2);
    expect(t.messages[0]).toMatchObject({ role: "human", text: "what is BSB?" });
    expect(t.messages[1]?.role).toBe("assistant");
  });
});

describe("captureGrokConversation (fake network)", () => {
  it("fetches responses and normalizes", async () => {
    const fake: FetchLike = async (url) =>
      url.includes("/responses")
        ? { ok: true, status: 200, json: async () => ({ responses: [{ sender: "human", query: "hi" }] }) }
        : { ok: false, status: 404, json: async () => ({}) };
    const t = await captureGrokConversation("c1", { fetchImpl: fake, capturedAt: AT });
    expect(t.messages).toHaveLength(1);
  });
});
