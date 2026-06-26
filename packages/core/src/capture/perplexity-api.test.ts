import { describe, it, expect } from "vitest";
import {
  normalizePerplexityThread,
  perplexityThreadIdFromUrl,
  capturePerplexityThread,
} from "./perplexity-api.js";
import type { FetchLike } from "./claude-api.js";

const AT = "2026-06-27T00:00:00Z";

describe("perplexityThreadIdFromUrl", () => {
  it("reads the slug from /search/{slug}", () => {
    expect(
      perplexityThreadIdFromUrl("https://www.perplexity.ai/search/how-to-foo-Ab12Cd34"),
    ).toBe("how-to-foo-Ab12Cd34");
  });
  it("returns null without a search path", () => {
    expect(perplexityThreadIdFromUrl("https://www.perplexity.ai/")).toBeNull();
  });
});

describe("normalizePerplexityThread", () => {
  it("turns chat_messages into a transcript", () => {
    const t = normalizePerplexityThread(
      {
        title: "DB choice",
        slug: "db-choice-x1",
        chat_messages: [
          { sender: "user", text: "postgres or dynamo?" },
          { sender: "assistant", text: "postgres, your data is relational" },
        ],
      },
      { capturedAt: AT },
    );
    expect(t.title).toBe("DB choice");
    expect(t.messages.map((m) => m.role)).toEqual(["human", "assistant"]);
    expect(t.messages[1]?.text).toContain("relational");
  });

  it("appends source cards (search_results) to the answer", () => {
    const t = normalizePerplexityThread(
      {
        chat_messages: [
          {
            sender: "assistant",
            text: "Liquid IV has additives; LMNT does not.",
            search_results: [{ title: "LMNT", url: "https://drinklmnt.com" }],
          },
        ],
      },
      { capturedAt: AT },
    );
    expect(t.messages[0]?.text).toContain("Sources:");
    expect(t.messages[0]?.text).toContain("https://drinklmnt.com");
  });

  it("splits an entry that packs both query and answer", () => {
    const t = normalizePerplexityThread(
      { chat_messages: [{ query: "what is BSB?", answer: "Bank-State-Branch code" }] },
      { capturedAt: AT },
    );
    expect(t.messages).toHaveLength(2);
    expect(t.messages[0]).toMatchObject({ role: "human", text: "what is BSB?" });
    expect(t.messages[1]?.role).toBe("assistant");
  });
});

describe("capturePerplexityThread (fake network)", () => {
  it("fetches and normalizes", async () => {
    const fake: FetchLike = async (url) =>
      url.includes("/rest/thread/")
        ? { ok: true, status: 200, json: async () => ({ title: "T", chat_messages: [{ sender: "user", text: "hi" }] }) }
        : { ok: false, status: 404, json: async () => ({}) };
    const t = await capturePerplexityThread("slug-1", { fetchImpl: fake, capturedAt: AT });
    expect(t.title).toBe("T");
    expect(t.messages).toHaveLength(1);
  });
});
