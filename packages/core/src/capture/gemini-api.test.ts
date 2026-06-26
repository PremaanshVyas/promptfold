import { describe, it, expect } from "vitest";
import {
  extractRpcPayload,
  normalizeGeminiPayload,
  geminiConversationIdFromUrl,
  captureGeminiConversation,
  type PostFetch,
} from "./gemini-api.js";

const AT = "2026-06-27T00:00:00Z";

describe("geminiConversationIdFromUrl", () => {
  it("reads /app/{cid}", () => {
    expect(geminiConversationIdFromUrl("https://gemini.google.com/app/c_abc123def456")).toBe(
      "c_abc123def456",
    );
  });
});

describe("extractRpcPayload", () => {
  it("de-frames a batchexecute response and returns the rpc payload", () => {
    const payload = JSON.stringify([[["turn1"]]]);
    const frame = JSON.stringify([["wrb.fr", "hNvQHb", payload, null, null, null, "generic"]]);
    const body = `)]}'\n\n123\n${frame}\n45\n[["di",27]]`;
    const got = extractRpcPayload(body, "hNvQHb");
    expect(got).toEqual([[["turn1"]]]);
  });
});

describe("normalizeGeminiPayload", () => {
  it("pulls user + model text from the positional arrays", () => {
    // turns[0]: user text at [2][0][0]; model candidate at [3][0], text at [1][0]
    const turn = [
      null,
      null,
      [["how do I get my salary to an AU account?"]],
      [[null, ["Provide BSB, Swift, and account number."]]],
    ];
    const t = normalizeGeminiPayload([[turn]][0] ? [turn] : [], { capturedAt: AT });
    // wrap as payload[0] = turns
    const real = normalizeGeminiPayload([[turn]], { capturedAt: AT });
    expect(real.messages[0]).toMatchObject({ role: "human" });
    expect(real.messages[0]?.text).toContain("AU account");
    expect(real.messages[1]?.role).toBe("assistant");
    expect(real.messages[1]?.text).toContain("BSB");
    expect(t).toBeDefined();
  });
});

describe("captureGeminiConversation (fake network)", () => {
  it("posts the read-chat RPC and parses the reply", async () => {
    const turn = [null, null, [["hi"]], [[null, ["hello"]]]];
    const payload = JSON.stringify([[turn]]);
    const frame = JSON.stringify([["wrb.fr", "hNvQHb", payload]]);
    const fakePost: PostFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `)]}'\n10\n${frame}`,
    });
    const t = await captureGeminiConversation("c_1", {
      post: fakePost,
      tokens: { at: "tok" },
      capturedAt: AT,
    });
    expect(t.messages.map((m) => m.role)).toEqual(["human", "assistant"]);
  });
});
