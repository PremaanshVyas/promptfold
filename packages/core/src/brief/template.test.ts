import { describe, it, expect } from "vitest";
import { renderBrief } from "./template.js";
import type { BriefState } from "../types.js";

function baseState(over: Partial<BriefState> = {}): BriefState {
  return {
    decided: [{ text: "use TypeScript" }],
    open: [{ text: "pick a hosting region" }],
    rejected: [{ idea: "React in the content script", why: "bundle weight per page load" }],
    verbatim: [{ kind: "number", label: "timeout", value: "60" }],
    filesToAttach: [{ name: "upload_handler.py", why: "only a snippet was shown", source: "referenced" }],
    meta: {
      conversationId: "c1",
      title: "Test chat",
      producedBy: "fake:model",
      integrity: { totalBlocks: 5, classifiedBlocks: 5, unknown: [], complete: true },
      rawFallbacks: [],
    },
    ...over,
  };
}

describe("renderBrief", () => {
  it("renders both framings with all sections", () => {
    const { humanMarkdown, resumePrompt } = renderBrief(baseState());
    for (const out of [humanMarkdown, resumePrompt]) {
      expect(out).toContain("use TypeScript");
      expect(out).toContain("React in the content script");
      expect(out).toContain("bundle weight per page load");
      expect(out).toContain("upload_handler.py");
      expect(out).toContain("60");
    }
  });

  it("the resume prompt tells the next bot not to reopen rejected ideas", () => {
    const { resumePrompt } = renderBrief(baseState());
    expect(resumePrompt.toLowerCase()).toContain("rejected");
    expect(resumePrompt.toLowerCase()).toContain("continue");
  });

  it("shows a LOUD banner and a raw appendix when capture was incomplete", () => {
    const state = baseState({
      meta: {
        conversationId: "c1",
        title: "Test chat",
        producedBy: "fake:model",
        integrity: {
          totalBlocks: 5,
          classifiedBlocks: 4,
          unknown: [{ messageUuid: "m4xxxxxx", hint: "type:mystery", preview: "weird stuff" }],
          complete: false,
        },
        rawFallbacks: [],
      },
    });
    const { humanMarkdown } = renderBrief(state);
    expect(humanMarkdown).toContain("⚠️");
    expect(humanMarkdown).toContain("could not be parsed");
    expect(humanMarkdown).toContain("weird stuff"); // raw preview, not dropped
  });

  it("warns when the distiller fell back", () => {
    const state = baseState({
      meta: {
        conversationId: "c1",
        title: "Test chat",
        producedBy: "fake:model",
        integrity: { totalBlocks: 5, classifiedBlocks: 5, unknown: [], complete: true },
        rawFallbacks: ["Chunk 2/3 did not parse; raw output kept out of merge."],
      },
    });
    const { humanMarkdown } = renderBrief(state);
    expect(humanMarkdown).toContain("Distiller fell back");
  });
});
