/**
 * Hand-built fixtures mirroring the real claude.ai conversation shapes the
 * research documented. Synthetic, no real user data. Exercises:
 *   - all three artifact formats (create_file json_block, artifacts code_block,
 *     legacy antArtifact tag)
 *   - a branched message tree (an abandoned edit branch that must be ignored)
 *   - an unknown block type (must be surfaced, not dropped)
 */

import type { ClaudeConversation } from "../types.js";

/** A small conversation with one of each artifact format + an unknown block. */
export const mixedArtifactsConvo: ClaudeConversation = {
  uuid: "conv-mixed-1",
  name: "Build the upload handler",
  current_leaf_message_uuid: "m4",
  chat_messages: [
    {
      uuid: "m1",
      parent_message_uuid: undefined,
      sender: "human",
      content: [{ type: "text", text: "Write upload_handler.py with a checksum step." }],
      created_at: "2026-06-26T10:00:00Z",
    },
    {
      uuid: "m2",
      parent_message_uuid: "m1",
      sender: "assistant",
      content: [
        { type: "text", text: "Here it is." },
        {
          type: "tool_use",
          name: "create_file",
          input: {
            display_content: JSON.stringify({
              filename: "upload_handler.py",
              language: "python",
              code: "def handle(f):\n    return checksum(f)",
            }),
          },
        },
        // a non-artifact tool, must be treated as noise, not unknown
        { type: "tool_use", name: "bash", input: { command: "ls" } },
      ],
      created_at: "2026-06-26T10:01:00Z",
    },
    {
      uuid: "m3",
      parent_message_uuid: "m2",
      sender: "assistant",
      content: [
        { type: "text", text: "And a config artifact:" },
        {
          type: "tool_use",
          name: "artifacts",
          input: {
            display_content: {
              filename: "config.yaml",
              language: "yaml",
              content: "timeout: 60\n",
            },
          },
        },
      ],
      created_at: "2026-06-26T10:02:00Z",
    },
    {
      uuid: "m4",
      parent_message_uuid: "m3",
      sender: "assistant",
      content: [
        {
          type: "text",
          text:
            'Legacy artifact:\n<antArtifact identifier="notes.md" type="text/markdown" title="Notes">\n# Notes\nremember the checksum\n</antArtifact>\nDone.',
        },
        // an unknown block type, must surface in integrity.unknown
        { type: "mystery_block", payload: { weird: true } },
      ],
      created_at: "2026-06-26T10:03:00Z",
    },
    // An ABANDONED branch off m1 (edit), must be excluded by activeBranch.
    {
      uuid: "m2-alt",
      parent_message_uuid: "m1",
      sender: "assistant",
      content: [{ type: "text", text: "This is the abandoned edit branch." }],
      created_at: "2026-06-26T10:01:30Z",
    },
  ],
};

/**
 * Mirrors a REAL sandbox/writing chat (the shape that broke the first build):
 * create_file carries content in `file_text` + `path` (NOT display_content),
 * and bash_tool / str_replace / view / present_files are tool operations, not
 * artifacts and not "unknown".
 */
export const sandboxWritingConvo: ClaudeConversation = {
  uuid: "conv-sandbox-1",
  name: "Write an essay",
  current_leaf_message_uuid: "s2",
  chat_messages: [
    { uuid: "s1", sender: "human", content: [{ type: "text", text: "Write a short essay." }] },
    {
      uuid: "s2",
      parent_message_uuid: "s1",
      sender: "assistant",
      content: [
        { type: "text", text: "Drafting now." },
        { type: "tool_use", name: "bash_tool", input: { command: "mkdir -p /home/claude/essay" } },
        {
          type: "tool_use",
          name: "create_file",
          input: {
            description: "Draft",
            path: "/home/claude/essay/draft.md",
            file_text: "# Essay\nFirst draft body.",
          },
        },
        {
          type: "tool_use",
          name: "str_replace",
          input: { path: "/home/claude/essay/draft.md", old_str: "First", new_str: "Revised" },
        },
        { type: "tool_use", name: "view", input: { path: "/home/claude/essay/draft.md" } },
        {
          type: "tool_use",
          name: "create_file",
          input: {
            path: "/mnt/user-data/outputs/final-essay.md",
            file_text: "# Essay\nFinal body, much improved.",
          },
        },
        { type: "tool_use", name: "present_files", input: { filepaths: ["/mnt/user-data/outputs/final-essay.md"] } },
      ],
    },
  ],
};

/** A simple linear conversation, no tree pointers (older shape, flat text). */
export const flatTextConvo: ClaudeConversation = {
  uuid: "conv-flat-1",
  name: "Quick chat",
  chat_messages: [
    { uuid: "a", sender: "human", text: "Hi" },
    { uuid: "b", sender: "assistant", text: "Hello! The API is at https://api.example.com/v1" },
  ],
};
