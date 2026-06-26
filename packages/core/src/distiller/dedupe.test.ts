import { describe, it, expect } from "vitest";
import { collapseArtifactLineage } from "./dedupe.js";
import type { Artifact } from "../types.js";

function art(id: string, filename: string, content: string): Artifact {
  return { id, filename, content, format: "tool_use", messageUuid: "m" };
}

describe("collapseArtifactLineage", () => {
  it("collapses evolving drafts of one document to the latest version", () => {
    const base = "the v line from southern cross to wyndham vale takes thirty five minutes and i have no signal ";
    const drafts = [
      art("1", "draft.md", base + "first draft version alpha"),
      art("2", "draft2.md", base + "second draft version beta"),
      art("3", "draft3.md", base + "third draft version gamma"),
      art("4", "final.md", base + "final draft version omega"),
    ];
    const kept = collapseArtifactLineage(drafts);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.filename).toBe("final.md"); // latest wins
    expect(kept[0]?.content).toContain("omega");
  });

  it("keeps genuinely different files separate", () => {
    const kept = collapseArtifactLineage([
      art("1", "essay.md", "a long essay about being human amid technology and trains"),
      art("2", "config.yaml", "timeout: 60\nretries: 3\nhost: localhost\nport: 5432"),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("is a no-op on a single artifact", () => {
    const kept = collapseArtifactLineage([art("1", "a.md", "hello world content here")]);
    expect(kept).toHaveLength(1);
  });
});
