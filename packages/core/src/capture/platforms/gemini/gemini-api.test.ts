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
    // Real shape (confirmed against a live response):
    //   user text  -> turn[2][0][0]
    //   candidates -> turn[3][0]  (a LIST)
    //   candidate  -> turn[3][0][0] = [rcid, [text], ...]
    const candidate = ["rc_x", ["Provide BSB, Swift, and account number."]];
    const turn = [
      ["c_1", "r_1"],
      ["c_1", "r_1", "rc_x"],
      [["how do I get my salary to an AU account?", null, null, null, [[]]], 2],
      [[candidate]],
    ];
    const real = normalizeGeminiPayload([[turn]], { capturedAt: AT });
    expect(real.messages[0]).toMatchObject({ role: "human" });
    expect(real.messages[0]?.text).toContain("AU account");
    expect(real.messages[1]?.role).toBe("assistant");
    expect(real.messages[1]?.text).toContain("BSB");
  });

  it("captures a markdown TABLE that the model returned inline", () => {
    // Mirrors the real conversation: 'lets decide on some ingredients on a table
    // form'. The table is inline markdown in the model's answer (candidate[1][0]).
    const answer =
      "Here is the formulation:\n\n" +
      "| Ingredient | Amount | Why |\n" +
      "| --- | --- | --- |\n" +
      "| Sodium citrate | 500mg | electrolyte |\n" +
      "| Potassium chloride | 200mg | electrolyte |\n\n" +
      "No gums or sweeteners.";
    const candidate = ["rc_dd81", [answer]];
    const turn = [
      ["c_1", "r_1"],
      ["c_1", "r_1", "rc_dd81"],
      [["lets decide on some ingredients on a table form and not in the chat", null, null, null, [[]]], 2],
      [[candidate]],
    ];
    const t = normalizeGeminiPayload([[turn]], { capturedAt: AT });
    const assistant = t.messages.find((m) => m.role === "assistant");
    expect(assistant?.text).toContain("| Ingredient | Amount | Why |");
    expect(assistant?.text).toContain("Sodium citrate");
  });

  it("picks the first non-empty draft when a turn has several candidates", () => {
    const empty = ["rc_a", [""]];
    const real = ["rc_b", ["the actual answer"]];
    const turn = [null, null, [["q", null, null, null, [[]]], 2], [[empty, real]]];
    const t = normalizeGeminiPayload([[turn]], { capturedAt: AT });
    expect(t.messages.find((m) => m.role === "assistant")?.text).toBe("the actual answer");
  });
});

describe("normalizeGeminiPayload — canvas document at candidate[30]", () => {
  it("captures the canvas/immersive doc body as an artifact", () => {
    const docBody =
      "# Electrolyte comparison\n\n| Brand | Sodium | Additives |\n| --- | --- | --- |\n| Liquid IV | 500mg | yes |\n| LMNT | 1000mg | no |";
    const candidate: unknown[] = ["rc_doc", ["Here's the document I made."]];
    candidate[30] = [["doc-id"], [docBody]]; // canvas body lives in [30], nested
    const turn = [null, null, [["compare electrolyte drinks", null, null, null, [[]]], 2], [[candidate]]];
    const t = normalizeGeminiPayload([[turn]], { capturedAt: AT });
    expect(t.artifacts).toHaveLength(1);
    expect(t.artifacts[0]?.content).toContain("LMNT");
    expect(t.artifacts[0]?.presented).toBe(true);
  });
});

describe("captureGeminiConversation (fake network)", () => {
  it("posts the read-chat RPC and parses the reply", async () => {
    const candidate = ["rc_x", ["hello"]];
    const turn = [["c_1", "r_1"], ["c_1", "r_1", "rc_x"], [["hi", null, null, null, [[]]], 2], [[candidate]]];
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
    expect(t.messages[1]?.text).toBe("hello");
  });
});
