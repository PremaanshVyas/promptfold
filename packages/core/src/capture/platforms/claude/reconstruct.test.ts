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
