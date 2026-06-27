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

  it("captures an image by SUBJECT, never the URL, and never as a gallery", () => {
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "liquid iv",
      chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "show me the product" }] },
        {
          uuid: "a",
          sender: "assistant",
          content: [{ type: "text", text: "Here it is:\n\n![Liquid IV hydration packet](https://img.example/liquid-iv.png)\n\nClean label." }],
        },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    const images = brief.verbatim.filter((v) => v.kind === "image");
    expect(images).toHaveLength(1);
    expect(images[0]?.value).toBe("Liquid IV hydration packet"); // subject, not URL
    expect(images[0]?.value).not.toMatch(/https?:\/\//); // URL is discarded
  });

  it("captures a Claude image content block by description, not URL", () => {
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "img block",
      chat_messages: [
        {
          uuid: "a",
          sender: "assistant",
          content: [
            { type: "text", text: "result:" },
            { type: "image", alt_text: "product shot", source: { type: "url", url: "https://img.example/p.jpg" } },
          ],
        },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    const img = brief.verbatim.find((v) => v.kind === "image");
    expect(img?.value).toBe("product shot");
    expect(img?.value).not.toMatch(/https?:\/\//);
    expect(t.integrity.unknown).toEqual([]);
  });

  it("emits ONE image item for a turn with both an image block and search thumbnails (no triple, no fragment)", () => {
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "liquid iv images",
      chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "show liquid iv flavours" }] },
        {
          uuid: "a",
          sender: "assistant",
          content: [
            { type: "text", text: "Here you go." },
            { type: "image", alt_text: "Liquid I.V. Golden Cherry hydration", source: { type: "url", url: "https://img.example/gc.jpg" } },
            {
              type: "web_search_tool_result",
              content: [
                { type: "web_search_result", title: "Liquid I.V. Golden Cherry", url: "https://img.example/a.jpg" },
                { type: "web_search_result", title: "Liquid Death sparkling", url: "https://img.example/b.jpg" },
              ],
            },
          ],
        },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const images = distillDeterministic(t).verbatim.filter((v) => v.kind === "image");
    // Exactly one image entry for the turn, and its value is a real subject,
    // not the truncated common-prefix fragment "Liquid".
    expect(images).toHaveLength(1);
    expect(images[0]?.value).not.toBe("Liquid");
    expect(images[0]?.value.toLowerCase()).toContain("liquid i.v.");
    expect(images[0]?.value).not.toMatch(/https?:\/\//);
  });

  it("keeps spreadsheet formulas as separate constraint items, never merged or typed api", () => {
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "ratios",
      chat_messages: [
        {
          uuid: "a",
          sender: "assistant",
          content: [{ type: "text", text: "Sodium ratio uses =B2/B3 and potassium uses =C2/C3 in the sheet." }],
        },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    const formulas = brief.verbatim.filter((v) => v.value === "=B2/B3" || v.value === "=C2/C3");
    expect(formulas).toHaveLength(2); // two separate items
    expect(formulas.every((f) => f.kind === "constraint")).toBe(true); // not api
  });

  it("never states a fabricated char/byte count for a presented file", () => {
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "meta",
      current_leaf_message_uuid: "a1",
      chat_messages: [
        { uuid: "u1", sender: "human", content: [{ type: "text", text: "make the file" }] },
        {
          uuid: "a1",
          parent_message_uuid: "u1",
          sender: "assistant",
          content: [
            { type: "tool_use", name: "create_file", input: { path: "/mnt/user-data/outputs/liquid_iv_meta.json", file_text: "x".repeat(2000) } },
            { type: "tool_use", name: "present_files", input: { filepaths: ["/mnt/user-data/outputs/liquid_iv_meta.json"] } },
          ],
        },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const brief = distillDeterministic(t);
    const file = brief.filesToAttach.find((f) => f.name.includes("liquid_iv_meta"));
    expect(file).toBeDefined();
    expect(file?.why).not.toMatch(/\d+\s*(chars?|bytes?)/i); // no fabricated size
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
