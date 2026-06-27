import { describe, it, expect } from "vitest";
import { distillDeterministic } from "./deterministic.js";
import { normalizeConversation } from "../capture/index.js";
import { mixedArtifactsConvo } from "../capture/platforms/claude/__fixtures__/conversations.js";
import type { ClaudeConversation } from "../types.js";

const AT = "2026-06-26T12:00:00Z";

describe("distillDeterministic (Tier 0)", () => {
  it("turns small artifacts into inline verbatim code", () => {
    const t = normalizeConversation(mixedArtifactsConvo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    const handler = brief.verbatim.find((v) => v.label === "upload_handler.py");
    expect(handler?.kind).toBe("code");
    expect(handler?.value).toContain("checksum(f)");
  });

  it("leaves the reasoning sections empty (no model = no reasoning)", () => {
    const t = normalizeConversation(mixedArtifactsConvo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    expect(brief.decided).toEqual([]);
    expect(brief.open).toEqual([]);
    expect(brief.rejected).toEqual([]);
    expect(brief.meta.producedBy).toBe("deterministic");
  });

  it("flags a referenced-but-absent file to attach", () => {
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "x",
      chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "the bug is in services/auth.py somewhere" }] },
        { uuid: "a", sender: "assistant", content: [{ type: "text", text: "can you share it?" }] },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    const f = brief.filesToAttach.find((x) => x.name === "services/auth.py");
    expect(f?.source).toBe("referenced");
  });

  it("does NOT flag a file the chat actually produced as 'referenced'", () => {
    const t = normalizeConversation(mixedArtifactsConvo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    // upload_handler.py was produced as an artifact → not in referenced files.
    const ref = brief.filesToAttach.find(
      (f) => f.name === "upload_handler.py" && f.source === "referenced",
    );
    expect(ref).toBeUndefined();
  });

  it("does NOT list a sandbox output path as a separate referenced file", () => {
    // The assistant mentions the internal output path in its text. It must not
    // appear as a duplicate of the real deliverable.
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "essay",
      current_leaf_message_uuid: "a1",
      chat_messages: [
        { uuid: "u1", sender: "human", content: [{ type: "text", text: "write it" }] },
        {
          uuid: "a1",
          parent_message_uuid: "u1",
          sender: "assistant",
          content: [
            { type: "text", text: "Saved to /mnt/user-data/outputs/essay.md and essay.txt" },
            { type: "tool_use", name: "create_file", input: { path: "/mnt/user-data/outputs/essay.txt", file_text: "the essay" } },
            { type: "tool_use", name: "present_files", input: { filepaths: ["/mnt/user-data/outputs/essay.txt"] } },
          ],
        },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    // Exactly one file for the essay (stem "essay"), the produced deliverable.
    const essayFiles = brief.filesToAttach.filter((f) => f.name.toLowerCase().includes("essay"));
    expect(essayFiles).toHaveLength(1);
    expect(essayFiles[0]?.source).toBe("chat");
  });

  it("force-captures a markdown table from the chat into verbatim", () => {
    const table =
      "| Brand | Sodium | Additives |\n| --- | --- | --- |\n| Liquid IV | 500mg | yes |\n| LMNT | 1000mg | no |";
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "electrolytes",
      chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "compare them" }] },
        { uuid: "a", sender: "assistant", content: [{ type: "text", text: `Here you go:\n\n${table}\n\nLMNT wins on sodium.` }] },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    const tableItem = brief.verbatim.find((v) => v.kind === "table");
    expect(tableItem).toBeDefined();
    expect(tableItem?.value).toContain("LMNT");
    expect(tableItem?.value).toContain("1000mg");
  });

  it("extracts API endpoints and urls as verbatim", () => {
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "x",
      chat_messages: [
        { uuid: "a", sender: "assistant", content: [{ type: "text", text: "Call GET /api/v1/users and POST https://x.io/login" }] },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    const apis = brief.verbatim.filter((v) => v.kind === "api").map((v) => v.value);
    expect(apis).toContain("GET /api/v1/users");
    expect(apis.some((a) => a.includes("https://x.io/login"))).toBe(true);
  });
});
