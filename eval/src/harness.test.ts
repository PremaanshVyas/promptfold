import { describe, it, expect } from "vitest";
import { runFixture } from "./harness.js";
import { FIXTURES } from "./fixtures.js";

const AT = "2026-06-26T00:00:00Z";

describe("eval harness (deterministic, no key)", () => {
  it("produces a brief meaningfully smaller than the full chat", async () => {
    const fixture = FIXTURES.find((f) => f.id === "db-choice")!;
    const entry = await runFixture(fixture, { capturedAt: AT });
    expect(entry.reduction).toBeGreaterThan(0.2); // brief is >20% smaller
    expect(entry.fullChars).toBeGreaterThan(entry.briefChars);
  });

  it("flags the referenced-but-absent db file to attach", async () => {
    const fixture = FIXTURES.find((f) => f.id === "db-choice")!;
    const entry = await runFixture(fixture, { capturedAt: AT });
    // The chat referred to db.ts but never showed it.
    expect(entry.sections.files).toBeGreaterThan(0);
  });

  it("runs every fixture without throwing", async () => {
    for (const fixture of FIXTURES) {
      const entry = await runFixture(fixture, { capturedAt: AT });
      expect(entry.id).toBe(fixture.id);
      expect(entry.integrityComplete).toBe(true);
    }
  });
});
