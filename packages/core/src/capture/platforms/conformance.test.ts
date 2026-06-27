import { describe, it, expect } from "vitest";
import type { GptConversation } from "./chatgpt/chatgpt-api.js";
import { normalizeConversation } from "./claude/normalize.js";
import { normalizeChatGptConversation } from "./chatgpt/chatgpt-api.js";
import { normalizeGeminiPayload } from "./gemini/gemini-api.js";
import { normalizePerplexityThread } from "./perplexity/perplexity-api.js";
import { normalizeGrok } from "./grok/grok-api.js";
import { normalizeDeepSeek } from "./deepseek/deepseek-api.js";
import { normalizeHfConversation } from "./huggingface/hf-chat-api.js";
import { distillDeterministic } from "../../distiller/deterministic.js";
import type { NormalizedTranscript } from "../../types.js";

/**
 * Cross-platform CONFORMANCE / PARITY suite.
 *
 * Capture is per-platform (each chatbot has a different data layer), but the
 * PRODUCT promise is that every chatbot behaves the same: the same content in a
 * chat must reach the brief the same way, whichever platform it came from. This
 * suite feeds the SAME conversation (a user question + an assistant answer that
 * contains a markdown table, a fenced code block, and prose) to every adapter's
 * normalizer, then asserts they all produce an equivalent normalized transcript
 * AND that the shared distiller extracts the same load-bearing content from each.
 *
 * If a change to one platform ever drops a content type or diverges from the
 * others, this fails, so working on one chatbot cannot silently regress another.
 */

const AT = "2026-06-27T00:00:00Z";

const USER = "compare the two electrolyte mixes and show the helper function";
const TABLE =
  "| Brand | Sodium | Potassium |\n| --- | --- | --- |\n| Liquid IV | 500mg | 370mg |\n| LMNT | 1000mg | 200mg |";
const CODE = "```python\ndef ratio(na, k):\n    return round(na / k, 2)\n```";
const ASSISTANT = `Here is the comparison:\n\n${TABLE}\n\nAnd the helper:\n\n${CODE}\n\nLMNT is more sodium-dominant.`;

/** Build a ChatGPT mapping tree from an ordered list of {id, role, text}. */
function gptTree(nodes: Array<{ id: string; role: string; text: string }>): GptConversation {
  const mapping: GptConversation["mapping"] = {
    root: { id: "root", message: null, parent: null, children: [] },
  };
  let prev = "root";
  for (const n of nodes) {
    mapping[prev]!.children!.push(n.id);
    mapping[n.id] = {
      id: n.id,
      parent: prev,
      children: [],
      message: {
        id: n.id,
        author: { role: n.role },
        recipient: "all",
        content: { content_type: "text", parts: [n.text] },
      },
    };
    prev = n.id;
  }
  return { title: "Conformance", conversation_id: "conv-1", current_node: prev, mapping };
}

/** One normalizer per platform, each fed the SAME user+assistant content. */
const PLATFORMS: Array<{ name: string; normalize: () => NormalizedTranscript }> = [
  {
    name: "claude",
    normalize: () =>
      normalizeConversation(
        {
          uuid: "c",
          name: "Conformance",
          chat_messages: [
            { uuid: "u", sender: "human", content: [{ type: "text", text: USER }] },
            { uuid: "a", sender: "assistant", content: [{ type: "text", text: ASSISTANT }] },
          ],
        },
        { capturedAt: AT },
      ),
  },
  {
    name: "chatgpt",
    normalize: () =>
      normalizeChatGptConversation(
        gptTree([
          { id: "u", role: "user", text: USER },
          { id: "a", role: "assistant", text: ASSISTANT },
        ]),
        { capturedAt: AT },
      ),
  },
  {
    name: "gemini",
    normalize: () =>
      normalizeGeminiPayload(
        [
          [
            [
              ["c", "r"],
              ["c", "r", "rc"],
              [[USER, null, null, null, [[]]], 2],
              [[["rc", [ASSISTANT]]]],
            ],
          ],
        ],
        { capturedAt: AT },
      ),
  },
  {
    name: "perplexity",
    normalize: () =>
      normalizePerplexityThread(
        {
          title: "Conformance",
          slug: "conformance-x1",
          chat_messages: [
            { sender: "user", text: USER },
            { sender: "assistant", text: ASSISTANT },
          ],
        },
        { capturedAt: AT },
      ),
  },
  {
    name: "grok",
    normalize: () =>
      normalizeGrok(
        {
          responses: [
            { sender: "human", query: USER, message: "" },
            { sender: "assistant", message: ASSISTANT },
          ],
        },
        { capturedAt: AT },
      ),
  },
  {
    name: "deepseek",
    normalize: () =>
      normalizeDeepSeek(
        {
          data: {
            biz_data: {
              chat_messages: [
                { role: "user", content: USER },
                { role: "assistant", content: ASSISTANT },
              ],
            },
          },
        },
        { capturedAt: AT },
      ),
  },
  {
    name: "huggingface",
    normalize: () =>
      normalizeHfConversation(
        {
          title: "Conformance",
          messages: [
            { from: "user", content: USER },
            { from: "assistant", content: ASSISTANT },
          ],
        },
        { capturedAt: AT },
      ),
  },
];

describe("cross-platform capture parity", () => {
  it("covers all seven data-layer platforms", () => {
    expect(PLATFORMS.map((p) => p.name).sort()).toEqual(
      ["chatgpt", "claude", "deepseek", "gemini", "grok", "huggingface", "perplexity"],
    );
  });

  for (const platform of PLATFORMS) {
    describe(platform.name, () => {
      const t = platform.normalize();
      const assistant = t.messages.find((m) => m.role === "assistant");

      it("normalizes to a human + assistant transcript", () => {
        expect(t.messages.some((m) => m.role === "human")).toBe(true);
        expect(assistant).toBeDefined();
        expect(t.integrity.complete).toBe(true);
      });

      it("preserves the table and the code in the assistant text", () => {
        expect(assistant?.text).toContain("| Brand | Sodium | Potassium |");
        expect(assistant?.text).toContain("def ratio(na, k):");
      });

      it("the shared distiller extracts the same table and code from it", () => {
        const brief = distillDeterministic(t);
        const hasTable = brief.verbatim.some(
          (v) => v.kind === "table" && v.value.includes("Liquid IV") && v.value.includes("LMNT"),
        );
        const hasCode = brief.verbatim.some(
          (v) => v.kind === "code" && v.value.includes("def ratio(na, k):"),
        );
        expect(hasTable, `${platform.name}: table reached the brief`).toBe(true);
        expect(hasCode, `${platform.name}: code reached the brief`).toBe(true);
      });
    });
  }
});
