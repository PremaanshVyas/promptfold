import { describe, it, expect } from "vitest";
import {
  normalizeHfConversation,
  hfConversationIdFromUrl,
  captureHfConversation,
} from "./hf-chat-api.js";
import type { FetchLike } from "../../shared/http.js";

const AT = "2026-06-27T00:00:00Z";

describe("hfConversationIdFromUrl", () => {
  it("reads the 24-char ObjectId", () => {
    expect(
      hfConversationIdFromUrl("https://huggingface.co/chat/conversation/0123456789abcdef01234567"),
    ).toBe("0123456789abcdef01234567");
  });
  it("ignores a 7-char share id", () => {
    expect(hfConversationIdFromUrl("https://huggingface.co/chat/conversation/abc1234")).toBeNull();
  });
});

describe("normalizeHfConversation", () => {
  it("maps from=user/assistant and skips system", () => {
    const t = normalizeHfConversation(
      { title: "T", messages: [
        { from: "system", content: "sys" },
        { from: "user", content: "hi" },
        { from: "assistant", content: "yo" },
      ] },
      { capturedAt: AT },
    );
    expect(t.messages.map((m) => m.role)).toEqual(["human", "assistant"]);
  });

  it("reads the v2 superjson shape (.json.messages)", () => {
    const t = normalizeHfConversation(
      { json: { messages: [{ from: "user", content: "hi" }] } },
      { capturedAt: AT },
    );
    expect(t.messages).toHaveLength(1);
  });
});

describe("captureHfConversation (fake network)", () => {
  it("uses the clean /api/conversation route", async () => {
    const fake: FetchLike = async (url) =>
      url.includes("/api/conversation/")
        ? { ok: true, status: 200, json: async () => ({ messages: [{ from: "user", content: "hi" }] }) }
        : { ok: false, status: 404, json: async () => ({}) };
    const t = await captureHfConversation("0123456789abcdef01234567", { fetchImpl: fake, capturedAt: AT });
    expect(t.messages).toHaveLength(1);
  });
});
