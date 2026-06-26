import { describe, it, expect } from "vitest";
import { parseBriefSections, BriefParseError } from "./parse.js";

describe("parseBriefSections", () => {
  it("parses clean JSON", () => {
    const s = parseBriefSections(
      JSON.stringify({
        decided: [{ text: "use TS", replaces: "plain JS" }],
        open: [{ text: "naming" }],
        rejected: [{ idea: "react in content script", why: "bundle weight" }],
        verbatim: [{ kind: "number", label: "timeout", value: "60" }],
        filesToAttach: [{ name: "a.py", why: "core logic", source: "referenced" }],
      }),
    );
    expect(s.decided[0]?.replaces).toBe("plain JS");
    expect(s.rejected[0]?.why).toContain("bundle");
    expect(s.filesToAttach[0]?.source).toBe("referenced");
  });

  it("strips markdown fences and surrounding prose", () => {
    const out = 'Here you go:\n```json\n{"decided":[{"text":"ship it"}]}\n```\nDone.';
    const s = parseBriefSections(out);
    expect(s.decided[0]?.text).toBe("ship it");
  });

  it("tolerates missing sections (defaults to empty arrays)", () => {
    const s = parseBriefSections('{"decided":[{"text":"x"}]}');
    expect(s.open).toEqual([]);
    expect(s.verbatim).toEqual([]);
  });

  it("coerces an unknown verbatim kind to 'constraint'", () => {
    const s = parseBriefSections('{"verbatim":[{"kind":"wat","label":"l","value":"v"}]}');
    expect(s.verbatim[0]?.kind).toBe("constraint");
  });

  it("drops empty entries", () => {
    const s = parseBriefSections('{"decided":[{"text":""},{"text":"real"}]}');
    expect(s.decided).toHaveLength(1);
  });

  it("throws BriefParseError when there is no JSON object", () => {
    expect(() => parseBriefSections("sorry, no.")).toThrow(BriefParseError);
  });

  it("salvages complete items from JSON truncated mid-array (the merge cap bug)", () => {
    // Simulates the model hitting its token cap partway through the 3rd decision.
    const truncated =
      '{"decided":[{"text":"use postgres"},{"text":"timeout is 60"},{"text":"interview on June 3';
    const s = parseBriefSections(truncated);
    expect(s.decided.map((d) => d.text)).toEqual(["use postgres", "timeout is 60"]);
  });

  it("salvages across earlier sections when a later section is cut off", () => {
    const truncated =
      '{"decided":[{"text":"a"}],"rejected":[{"idea":"b","why":"c"}],"verbatim":[{"kind":"number","label":"x","value":"6';
    const s = parseBriefSections(truncated);
    expect(s.decided[0]?.text).toBe("a");
    expect(s.rejected[0]?.idea).toBe("b");
  });
});
