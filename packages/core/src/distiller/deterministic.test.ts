import { describe, it, expect } from "vitest";
import { distillDeterministic } from "./deterministic.js";
import { normalizeConversation } from "../capture/normalize.js";
import { mixedArtifactsConvo } from "../__fixtures__/conversations.js";
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
