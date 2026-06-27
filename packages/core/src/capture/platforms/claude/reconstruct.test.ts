import { describe, it, expect } from "vitest";
import { reconstructFiles } from "./reconstruct.js";
import type { ClaudeContentBlock } from "../../../types.js";

function tool(name: string, input: Record<string, unknown>): ClaudeContentBlock {
  return { type: "tool_use", name, input };
}

describe("reconstructFiles", () => {
  it("applies str_replace edits and reports the final content", () => {
    const { deliverables } = reconstructFiles([
      tool("create_file", { path: "/mnt/user-data/outputs/a.md", file_text: "Hello FIRST world" }),
      tool("str_replace", { path: "/mnt/user-data/outputs/a.md", old_str: "FIRST", new_str: "SECOND" }),
    ]);
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]?.content).toBe("Hello SECOND world");
  });

  it("follows a draft built in scratch, edited, then copied to outputs under a new name", () => {
    // Mirrors the real essay chat: build in /home/claude, edit, cp to outputs,
    // present the outputs file. The deliverable name is the PRESENTED name.
    const { deliverables } = reconstructFiles([
      tool("bash_tool", { command: "mkdir -p /home/claude/essay" }),
      tool("create_file", { path: "/home/claude/essay/draft.md", file_text: "essay v1 body" }),
      tool("str_replace", { path: "/home/claude/essay/draft.md", old_str: "v1", new_str: "v2" }),
      tool("bash_tool", { command: 'cd /home/claude/essay && cp draft.md "/mnt/user-data/outputs/the-final-name.txt"' }),
      tool("present_files", { filepaths: ["/mnt/user-data/outputs/the-final-name.txt"] }),
    ]);
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]?.name).toBe("the-final-name.txt");
    expect(deliverables[0]?.content).toBe("essay v2 body");
    expect(deliverables[0]?.presented).toBe(true);
  });

  it("excludes scratch files that were never presented or moved to outputs", () => {
    const { deliverables } = reconstructFiles([
      tool("create_file", { path: "/home/claude/scratch.py", file_text: "print(1)" }),
      tool("create_file", { path: "/mnt/user-data/outputs/result.csv", file_text: "a,b\n1,2" }),
    ]);
    // No present_files → deliverables are the outputs-dir files only.
    expect(deliverables.map((d) => d.name)).toEqual(["result.csv"]);
  });

  it("keeps an outputs-dir file as a deliverable even if present_files names only a subset", () => {
    // The chat produced six files in outputs but present_files listed only three.
    // The other three must NOT be dropped (or downgraded to 'referenced' later);
    // they were genuinely produced in the chat.
    const { deliverables } = reconstructFiles([
      tool("create_file", { path: "/mnt/user-data/outputs/a.pdf", file_text: "" }),
      tool("create_file", { path: "/mnt/user-data/outputs/b.json", file_text: "{}" }),
      tool("create_file", { path: "/mnt/user-data/outputs/c.xlsx", file_text: "" }),
      tool("create_file", { path: "/mnt/user-data/outputs/d.docx", file_text: "" }),
      tool("create_file", { path: "/mnt/user-data/outputs/e.md", file_text: "# notes" }),
      tool("create_file", { path: "/mnt/user-data/outputs/f.csv", file_text: "x,y" }),
      tool("present_files", { filepaths: [
        "/mnt/user-data/outputs/a.pdf",
        "/mnt/user-data/outputs/b.json",
        "/mnt/user-data/outputs/c.xlsx",
      ] }),
    ]);
    const names = deliverables.map((d) => d.name).sort();
    expect(names).toEqual(["a.pdf", "b.json", "c.xlsx", "d.docx", "e.md", "f.csv"]);
    // All six are produced in the chat, regardless of the present_files manifest.
    expect(deliverables).toHaveLength(6);
    // The three named in present_files are flagged presented; the rest are not,
    // but all are deliverables (the distiller tags every deliverable source:chat).
    const presented = deliverables.filter((d) => d.presented).map((d) => d.name).sort();
    expect(presented).toEqual(["a.pdf", "b.json", "c.xlsx"]);
  });

  it("marks binary deliverables and never inlines their content", () => {
    const { deliverables } = reconstructFiles([
      tool("bash_tool", { command: "python3 make_report.py" }),
      tool("present_files", { filepaths: ["/mnt/user-data/outputs/report.pdf"] }),
    ]);
    expect(deliverables[0]?.name).toBe("report.pdf");
    expect(deliverables[0]?.binary).toBe(true);
    expect(deliverables[0]?.content).toBe("");
  });

  it("handles mv (rename) keeping content, dropping the old path", () => {
    const { deliverables } = reconstructFiles([
      tool("create_file", { path: "/mnt/user-data/outputs/old.txt", file_text: "keep me" }),
      tool("bash_tool", { command: 'mv "/mnt/user-data/outputs/old.txt" "/mnt/user-data/outputs/new.txt"' }),
    ]);
    expect(deliverables.map((d) => d.name)).toEqual(["new.txt"]);
    expect(deliverables[0]?.content).toBe("keep me");
  });
});
