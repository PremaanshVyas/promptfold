import { describe, it, expect } from "vitest";
import { normalizeConversation, activeBranch } from "./normalize.js";
import {
  mixedArtifactsConvo,
  flatTextConvo,
  sandboxWritingConvo,
} from "../__fixtures__/conversations.js";

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

describe("normalizeConversation — capture completeness", () => {
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

describe("normalizeConversation — real sandbox/writing chat", () => {
  const t = normalizeConversation(sandboxWritingConvo, { capturedAt: AT });

  it("extracts create_file file_text+path as artifacts (the bug that broke v1)", () => {
    const names = t.artifacts.map((a) => a.filename).sort();
    expect(names).toEqual(["draft.md", "final-essay.md"]);
    const final = t.artifacts.find((a) => a.filename === "final-essay.md");
    expect(final?.content).toContain("Final body");
  });

  it("treats bash_tool / str_replace / view / present_files as noise, NOT unknown", () => {
    expect(t.integrity.complete).toBe(true);
    expect(t.integrity.unknown).toHaveLength(0);
  });
});

describe("normalizeConversation — flat/legacy shape", () => {
  it("handles flat text messages and a clean integrity report", () => {
    const t = normalizeConversation(flatTextConvo, { capturedAt: AT });
    expect(t.messages).toHaveLength(2);
    expect(t.integrity.complete).toBe(true);
    expect(t.title).toBe("Quick chat");
  });
});
