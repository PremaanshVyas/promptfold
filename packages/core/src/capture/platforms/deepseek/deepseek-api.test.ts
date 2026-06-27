import { describe, it, expect } from "vitest";
import {
  normalizeDeepSeek,
  deepseekSessionIdFromUrl,
  captureDeepSeekConversation,
} from "./deepseek-api.js";
import type { FetchLike } from "../../shared/http.js";

const AT = "2026-06-27T00:00:00Z";

describe("deepseekSessionIdFromUrl", () => {
  it("reads the session id from /a/chat/s/{id}", () => {
    expect(
      deepseekSessionIdFromUrl("https://chat.deepseek.com/a/chat/s/abcd1234-5678-90ab-cdef"),
    ).toBe("abcd1234-5678-90ab-cdef");
  });
});

describe("normalizeDeepSeek", () => {
  it("extracts messages from data.biz_data.chat_messages", () => {
    const raw = {
      code: 0,
      data: { biz_data: { chat_messages: [
        { role: "user", content: "postgres or dynamo?" },
        { role: "assistant", content: "postgres" },
      ] } },
    };
    const t = normalizeDeepSeek(raw, { capturedAt: AT });
    expect(t.messages.map((m) => m.role)).toEqual(["human", "assistant"]);
    expect(t.messages[1]?.text).toBe("postgres");
  });

  it("tolerates a flatter shape and object content", () => {
    const raw = { messages: [{ role: "ASSISTANT", content: { text: "hi" } }] };
    const t = normalizeDeepSeek(raw, { capturedAt: AT });
    expect(t.messages[0]).toMatchObject({ role: "assistant", text: "hi" });
  });
});

describe("captureDeepSeekConversation (fake network)", () => {
  it("sends the bearer token and normalizes", async () => {
    const fake: FetchLike = async (url) =>
      url.includes("/history_messages")
        ? { ok: true, status: 200, json: async () => ({ data: { biz_data: { chat_messages: [{ role: "user", content: "hi" }] } } }) }
        : { ok: false, status: 404, json: async () => ({}) };
    const t = await captureDeepSeekConversation("s1", { fetchImpl: fake, token: "tok", capturedAt: AT });
    expect(t.messages).toHaveLength(1);
  });
});
