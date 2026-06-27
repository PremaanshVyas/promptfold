import { describe, it, expect } from "vitest";
import {
  normalizeConversation,
  activeBranch,
  transcriptFromMessages,
} from "./normalize.js";
import { extractSearchContext, extractCitations } from "./artifact-parser.js";
import {
  mixedArtifactsConvo,
  flatTextConvo,
  sandboxWritingConvo,
} from "./__fixtures__/conversations.js";
import type { ClaudeConversation } from "../../../types.js";

const AT = "2026-06-26T12:00:00Z";

describe("activeBranch", () => {
  it("walks from the leaf and ignores abandoned edit branches", () => {
    const branch = activeBranch(mixedArtifactsConvo);
    const uuids = branch.map((m) => m.uuid);
    expect(uuids).toEqual(["m1", "m2", "m3", "m4"]);
    expect(uuids).not.toContain("m2-alt"); // abandoned branch excluded
  });

  it("falls back to raw order when there is no leaf pointer", () => {
    const branch = activeBranch(flatTextConvo);
    expect(branch.map((m) => m.uuid)).toEqual(["a", "b"]);
  });
});

describe("normalizeConversation, capture completeness", () => {
  const t = normalizeConversation(mixedArtifactsConvo, { capturedAt: AT });

  it("extracts all three artifact formats", () => {
    const filenames = t.artifacts.map((a) => a.filename ?? a.title).sort();
    expect(filenames).toEqual(["config.yaml", "notes.md", "upload_handler.py"]);
  });

  it("captures artifact content byte-for-byte", () => {
    const handler = t.artifacts.find((a) => a.filename === "upload_handler.py");
    expect(handler?.content).toBe("def handle(f):\n    return checksum(f)");
    expect(handler?.format).toBe("tool_use");

    const notes = t.artifacts.find((a) => a.title === "Notes" || a.filename === "notes.md");
    expect(notes?.format).toBe("antartifact");
    expect(notes?.content).toContain("remember the checksum");
  });

  it("treats known non-artifact tools (bash) as noise, not unknown", () => {
    // bash should not appear as an artifact nor as an unknown block.
    expect(t.artifacts.some((a) => a.content.includes("ls"))).toBe(false);
  });

  it("surfaces unknown block types loudly instead of dropping them", () => {
    expect(t.integrity.complete).toBe(false);
    expect(t.integrity.unknown).toHaveLength(1);
    expect(t.integrity.unknown[0]?.hint).toContain("mystery_block");
  });

  it("strips artifact/tool blocks out of message text", () => {
    const m4 = t.messages.find((m) => m.uuid === "m4");
    expect(m4?.text).not.toContain("antArtifact");
    expect(m4?.text).toContain("Done.");
  });

  it("gives every capture an integrity tally", () => {
    expect(t.integrity.totalBlocks).toBeGreaterThan(0);
    expect(t.integrity.classifiedBlocks).toBeLessThan(t.integrity.totalBlocks);
  });
});

describe("normalizeConversation, real sandbox/writing chat", () => {
  const t = normalizeConversation(sandboxWritingConvo, { capturedAt: AT });

  it("reconstructs only the PRESENTED deliverable, not intermediate drafts", () => {
    // draft.md lives in /home/claude (scratch) and was never presented; only the
    // /mnt/user-data/outputs file in present_files is a deliverable.
    const names = t.artifacts.map((a) => a.filename);
    expect(names).toEqual(["final-essay.md"]);
    const final = t.artifacts.find((a) => a.filename === "final-essay.md");
    expect(final?.content).toContain("Final body");
    expect(final?.presented).toBe(true);
  });

  it("treats the sandbox tool ops as classified, not unknown", () => {
    expect(t.integrity.complete).toBe(true);
    expect(t.integrity.unknown).toHaveLength(0);
  });
});

describe("transcriptFromMessages (generic DOM adapter bridge)", () => {
  it("builds a transcript from plain role/text messages", () => {
    const t = transcriptFromMessages(
      [
        { role: "human", text: "use postgres or dynamo?" },
        { role: "assistant", text: "postgres, your access is relational" },
        { role: "human", text: "  " }, // empty, dropped
      ],
      { conversationId: "/c/123", title: "DB chat", capturedAt: AT },
    );
    expect(t.messages).toHaveLength(2);
    expect(t.messages[0]?.role).toBe("human");
    expect(t.artifacts).toEqual([]);
    expect(t.integrity.complete).toBe(true);
    expect(t.title).toBe("DB chat");
  });
});

describe("normalizeConversation, flat/legacy shape", () => {
  it("handles flat text messages and a clean integrity report", () => {
    const t = normalizeConversation(flatTextConvo, { capturedAt: AT });
    expect(t.messages).toHaveLength(2);
    expect(t.integrity.complete).toBe(true);
    expect(t.title).toBe("Quick chat");
  });
});

describe("search-result mining (web_search / image subjects / citations)", () => {
  it("extractSearchContext pulls source titles and image urls out of a result block", () => {
    const block = {
      type: "web_search_tool_result",
      content: [
        { type: "web_search_result", title: "Liquid IV Tropical stick packs", url: "https://store.example/tropical", page_age: "2025" },
        { type: "web_search_result", title: "Liquid IV Lemon Lime", url: "https://store.example/lemon", image_url: "https://img.example/lemon.jpg" },
        { type: "web_search_result", title: "Golden Cherry photo", url: "https://img.example/cherry.png" },
      ],
    };
    const ctx = extractSearchContext(block);
    expect(ctx.sources.map((s) => s.title)).toContain("Liquid IV Tropical stick packs");
    // an image URL (direct .png, or an image_url field) becomes an image, not a source
    expect(ctx.images.map((i) => i.url)).toContain("https://img.example/cherry.png");
    expect(ctx.images.map((i) => i.url)).toContain("https://img.example/lemon.jpg");
  });

  it("extractCitations reads web_search_result_location off a text block", () => {
    const block = {
      type: "text",
      text: "Liquid IV is clean-label.",
      citations: [
        { type: "web_search_result_location", url: "https://src.example/a", title: "Source A", cited_text: "clean" },
      ],
    };
    expect(extractCitations(block)).toEqual([{ title: "Source A", url: "https://src.example/a" }]);
  });

  it("records image subjects structurally and sources in text, keeping integrity clean", () => {
    const convo: ClaudeConversation = {
      uuid: "c",
      name: "liquid iv images",
      chat_messages: [
        { uuid: "u", sender: "human", content: [{ type: "text", text: "show me liquid iv product photos" }] },
        {
          uuid: "a",
          sender: "assistant",
          content: [
            { type: "text", text: "Here are some Liquid IV products." },
            {
              type: "web_search_tool_result",
              content: [
                { type: "web_search_result", title: "Liquid IV Tropical stick packs", url: "https://store.example/tropical" },
                { type: "web_search_result", title: "Liquid IV product shot", url: "https://img.example/liquid-iv.jpg" },
              ],
            },
          ],
        },
      ],
    };
    const t = normalizeConversation(convo, { capturedAt: AT });
    const assistant = t.messages.find((m) => m.role === "assistant");
    // Non-image web result -> Sources (title + url kept) in text.
    expect(assistant?.text).toContain("Sources:");
    expect(assistant?.text).toContain("Liquid IV Tropical stick packs");
    // Image result -> ONE structured subject (no URL), never a text marker that
    // could be re-ingested, never an embedded image.
    expect(assistant?.images).toEqual(["Liquid IV product shot (image search)"]);
    expect(assistant?.text).not.toContain("[image shown:");
    expect(assistant?.text).not.toContain("![");
    expect(assistant?.text).not.toContain("img.example/liquid-iv.jpg");
    // The result block must NOT be flagged as an unclassified/unknown block.
    expect(t.integrity.unknown).toEqual([]);
  });
});
