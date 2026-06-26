import { describe, it, expect } from "vitest";
import {
  normalizeChatGptConversation,
  chatGptConversationIdFromUrl,
  captureChatGptConversation,
  type GptConversation,
} from "./chatgpt-api.js";
import type { FetchLike } from "./claude-api.js";

const AT = "2026-06-27T00:00:00Z";

/** Build a mapping tree from an ordered list of nodes (parent = previous). */
function tree(
  nodes: Array<{ id: string; role?: string; text?: string; recipient?: string; hidden?: boolean; canvasText?: string; textdocId?: string }>,
): GptConversation {
  const mapping: GptConversation["mapping"] = { root: { id: "root", message: null, parent: null, children: [] } };
  let prev = "root";
  for (const n of nodes) {
    mapping![prev]!.children!.push(n.id);
    mapping![n.id] = {
      id: n.id,
      parent: prev,
      children: [],
      message: {
        id: n.id,
        author: { role: n.role ?? "assistant" },
        recipient: n.recipient ?? "all",
        content: n.canvasText
          ? { content_type: "code", text: n.canvasText }
          : { content_type: "text", parts: [n.text ?? ""] },
        ...(n.hidden ? { metadata: { is_visually_hidden_from_conversation: true } } : {}),
        ...(n.textdocId ? { metadata: { canvas: { textdoc_id: n.textdocId } } } : {}),
      },
    };
    prev = n.id;
  }
  return { title: "Test chat", conversation_id: "conv-1", current_node: prev, mapping };
}

describe("chatGptConversationIdFromUrl", () => {
  it("reads /c/{uuid}", () => {
    expect(
      chatGptConversationIdFromUrl("https://chatgpt.com/c/abcdefab-1234-5678-9abc-def012345678"),
    ).toBe("abcdefab-1234-5678-9abc-def012345678");
  });
  it("reads project/GPT chat urls", () => {
    expect(
      chatGptConversationIdFromUrl("https://chatgpt.com/g/g-p-xyz/c/abcdefab-1234-5678-9abc-def012345678"),
    ).toBe("abcdefab-1234-5678-9abc-def012345678");
  });
  it("returns null for a share link", () => {
    expect(chatGptConversationIdFromUrl("https://chatgpt.com/share/foo")).toBeNull();
  });
});

describe("normalizeChatGptConversation", () => {
  it("recovers the FULL branch, including early messages (the virtualization fix)", () => {
    // This is the exact failure the DOM reader hit: it only saw later messages.
    const convo = tree([
      { id: "u1", role: "user", text: "how do I get salary to an Australian account?" },
      { id: "a1", role: "assistant", text: "Provide BSB, Swift, account number. Consider tax." },
      { id: "u2", role: "user", text: "write the internship confirmation email" },
      { id: "a2", role: "assistant", text: "Subject: Confirmation of Signed Internship Contract" },
    ]);
    const t = normalizeChatGptConversation(convo, { capturedAt: AT });
    expect(t.messages).toHaveLength(4);
    // The first topic is present, not dropped.
    expect(t.messages[0]?.text).toContain("Australian account");
    expect(t.messages[1]?.role).toBe("assistant");
  });

  it("maps user->human and assistant roles", () => {
    const t = normalizeChatGptConversation(
      tree([{ id: "u1", role: "user", text: "hi" }, { id: "a1", role: "assistant", text: "hello" }]),
      { capturedAt: AT },
    );
    expect(t.messages.map((m) => m.role)).toEqual(["human", "assistant"]);
  });

  it("skips hidden/system nodes", () => {
    const t = normalizeChatGptConversation(
      tree([
        { id: "s1", role: "system", text: "you are helpful", hidden: true },
        { id: "u1", role: "user", text: "real question" },
      ]),
      { capturedAt: AT },
    );
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]?.text).toBe("real question");
  });

  it("reconstructs a Canvas document (create then update) as an artifact", () => {
    const convo = tree([
      { id: "u1", role: "user", text: "make a canvas" },
      {
        id: "c1",
        role: "assistant",
        recipient: "canmore.create_textdoc",
        textdocId: "td1",
        canvasText: JSON.stringify({ name: "essay", type: "document", content: "Hello DRAFT world" }),
      },
      {
        id: "c2",
        role: "assistant",
        recipient: "canmore.update_textdoc",
        textdocId: "td1",
        canvasText: JSON.stringify({ updates: [{ pattern: "DRAFT", replacement: "FINAL" }] }),
      },
    ]);
    const t = normalizeChatGptConversation(convo, { capturedAt: AT });
    expect(t.artifacts).toHaveLength(1);
    expect(t.artifacts[0]?.filename).toBe("essay.md");
    expect(t.artifacts[0]?.content).toBe("Hello FINAL world");
    expect(t.artifacts[0]?.presented).toBe(true);
    // canvas tool nodes are not left in the prose transcript
    expect(t.messages.every((m) => !m.text.includes("DRAFT"))).toBe(true);
  });
});

describe("captureChatGptConversation end-to-end (fake network)", () => {
  it("fetches the session token then the conversation", async () => {
    const convo = tree([{ id: "u1", role: "user", text: "hi" }, { id: "a1", role: "assistant", text: "yo" }]);
    const fakeFetch: FetchLike = async (url) => {
      if (url.includes("/api/auth/session")) {
        return { ok: true, status: 200, json: async () => ({ accessToken: "tok-123" }) };
      }
      if (url.includes("/backend-api/conversation/")) {
        return { ok: true, status: 200, json: async () => convo };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const t = await captureChatGptConversation("conv-1", { fetchImpl: fakeFetch, capturedAt: AT });
    expect(t.title).toBe("Test chat");
    expect(t.messages).toHaveLength(2);
  });
});
