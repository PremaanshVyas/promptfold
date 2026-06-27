import { describe, it, expect } from "vitest";
import { distillWithModel } from "./distill.js";
import { normalizeConversation } from "../capture/index.js";
import type { LlmClient, LlmRequest } from "./llm.js";
import type { ClaudeConversation } from "../types.js";

const AT = "2026-06-26T12:00:00Z";

/** Build a transcript with N user/assistant turns to force chunking. */
function bigConvo(turns: number): ClaudeConversation {
  const msgs = [];
  for (let i = 0; i < turns; i++) {
    msgs.push({
      uuid: `u${i}`,
      sender: "human",
      content: [{ type: "text", text: `Question ${i} ` + "x".repeat(4000) }],
    });
    msgs.push({
      uuid: `a${i}`,
      sender: "assistant",
      content: [{ type: "text", text: `Answer ${i} ` + "y".repeat(4000) }],
    });
  }
  return { uuid: "big", name: "Big chat", chat_messages: msgs };
}

/** A fake model: returns chunk JSON for chunk prompts, a fixed merge for merge. */
function fakeClient(opts: {
  chunkOut?: (req: LlmRequest) => string;
  mergeOut?: string;
}): LlmClient {
  return {
    id: "fake:test-model",
    async complete(req: LlmRequest): Promise<string> {
      const isMerge = req.system.includes("You merge several mini-briefs");
      if (isMerge) {
        return (
          opts.mergeOut ??
          JSON.stringify({
            decided: [{ text: "timeout is 60" }],
            open: [],
            rejected: [{ idea: "timeout 30", why: "too short, requests timed out" }],
            verbatim: [{ kind: "number", label: "timeout", value: "60" }],
            filesToAttach: [],
          })
        );
      }
      return (
        opts.chunkOut?.(req) ??
        JSON.stringify({
          decided: [{ text: "use postgres" }],
          open: [{ text: "pick a hosting region" }],
          rejected: [],
          verbatim: [],
          filesToAttach: [],
        })
      );
    },
  };
}

describe("distillWithModel", () => {
  it("distills a single-chunk chat without a merge step", async () => {
    const t = normalizeConversation(
      { uuid: "c", name: "Small", chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "hi" }] },
        { uuid: "a", sender: "assistant", content: [{ type: "text", text: "use postgres" }] },
      ] },
      { capturedAt: AT },
    );
    const { brief, chunks } = await distillWithModel(t, fakeClient({}));
    expect(chunks).toBe(1);
    expect(brief.decided.map((d) => d.text)).toContain("use postgres");
    expect(brief.meta.producedBy).toBe("fake:test-model");
  });

  it("chunks a long chat and merges with latest-state-wins", async () => {
    const t = normalizeConversation(bigConvo(6), { capturedAt: AT });
    const { brief, chunks } = await distillWithModel(t, fakeClient({}), {
      maxChars: 9000,
    });
    expect(chunks).toBeGreaterThan(1);
    // The merge enforces the final value: 60, never the stale 30.
    expect(brief.verbatim.find((v) => v.label === "timeout")?.value).toBe("60");
    expect(brief.rejected.some((r) => r.idea.includes("30"))).toBe(true);
    expect(brief.decided.some((d) => d.text.includes("60"))).toBe(true);
  });

  it("records a loud rawFallback when a chunk returns unparseable JSON", async () => {
    const t = normalizeConversation(bigConvo(6), { capturedAt: AT });
    let call = 0;
    const client = fakeClient({
      chunkOut: () => {
        call += 1;
        return call === 1 ? "sorry, I cannot do that" : JSON.stringify({ decided: [] });
      },
    });
    const { brief } = await distillWithModel(t, client, { maxChars: 9000 });
    expect(brief.meta.rawFallbacks.length).toBeGreaterThan(0);
    expect(brief.meta.rawFallbacks.join(" ")).toContain("did not parse");
  });

  it("degrades to deterministic when the model produces nothing usable", async () => {
    const t = normalizeConversation(
      { uuid: "c", name: "x", chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "see foo.py" }] },
      ] },
      { capturedAt: AT },
    );
    const client = fakeClient({ chunkOut: () => "no json here at all" });
    const { brief } = await distillWithModel(t, client);
    expect(brief.meta.producedBy).toContain("fallback: deterministic");
    expect(brief.meta.rawFallbacks.join(" ")).toContain("deterministic");
  });

  it("does not add a duplicate table when the model already captured an equivalent one", async () => {
    const table =
      "| Brand | Sodium | Potassium |\n| --- | --- | --- |\n| Liquid IV | 500mg | 380mg |\n| LMNT | 1000mg | 200mg |";
    const t = normalizeConversation(
      { uuid: "c", name: "x", chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "compare" }] },
        { uuid: "a", sender: "assistant", content: [{ type: "text", text: `Here:\n\n${table}` }] },
      ] },
      { capturedAt: AT },
    );
    // The model returns the SAME table reformatted (extra spaces, a Vitamin C col).
    const modelTable =
      "| Brand | Sodium | Potassium | Vitamin C |\n|---|---|---|---|\n| Liquid IV | 500mg | 380mg | yes |\n| LMNT | 1000mg | 200mg | no |";
    const client = fakeClient({
      chunkOut: () => JSON.stringify({
        decided: [], open: [], rejected: [],
        verbatim: [{ kind: "table", label: "electrolyte comparison", value: modelTable }],
        filesToAttach: [],
      }),
    });
    const { brief } = await distillWithModel(t, client);
    const tables = brief.verbatim.filter((v) => v.kind === "table");
    expect(tables).toHaveLength(1); // the model's, not a near-duplicate pair
    expect(tables[0]?.label).toBe("electrolyte comparison");
  });

  it("unions model files-to-attach with the deterministic referenced-file detector", async () => {
    const t = normalizeConversation(
      { uuid: "c", name: "x", chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "use my real upload_handler.py please" }] },
        { uuid: "a", sender: "assistant", content: [{ type: "text", text: "ok" }] },
      ] },
      { capturedAt: AT },
    );
    const client = fakeClient({
      chunkOut: () => JSON.stringify({ decided: [], open: [], rejected: [], verbatim: [], filesToAttach: [] }),
    });
    const { brief } = await distillWithModel(t, client);
    expect(brief.filesToAttach.some((f) => f.name === "upload_handler.py")).toBe(true);
  });
});
