/**
 * Shared contracts for promptfold's core.
 *
 * Three units communicate only through these types:
 *   capture   →  NormalizedTranscript
 *   distiller →  BriefState
 *   brief     →  BriefFramings
 *
 * Keeping the boundaries in one file makes the data flow auditable at a glance.
 */

// ─────────────────────────────────────────────────────────────────────────
// Raw Claude API shapes (only the subset we depend on).
// Source: claude.ai /api/organizations and /chat_conversations endpoints.
// Treated as untrusted/partial, every field access is defensive.
// ─────────────────────────────────────────────────────────────────────────

export interface ClaudeOrg {
  uuid: string;
  name?: string;
  capabilities?: string[];
}

export interface ClaudeContentBlock {
  type?: string; // "text" | "tool_use" | "tool_result" | ...
  text?: string;
  name?: string; // for tool_use: "artifacts" | "create_file" | "bash" | ...
  input?: Record<string, unknown>;
  // Other fields exist; we read defensively and never assume shape.
  [key: string]: unknown;
}

export interface ClaudeAttachment {
  file_name?: string;
  file_type?: string;
  file_size?: number;
  extracted_content?: string;
}

export interface ClaudeMessage {
  uuid: string;
  parent_message_uuid?: string;
  sender?: string; // "human" | "assistant"
  text?: string;
  content?: ClaudeContentBlock[];
  created_at?: string;
  /** Files the user uploaded to this message (authoritative metadata). */
  attachments?: ClaudeAttachment[];
}

export interface ClaudeConversation {
  uuid: string;
  name?: string;
  chat_messages?: ClaudeMessage[];
  current_leaf_message_uuid?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Normalized transcript (capture output).
// ─────────────────────────────────────────────────────────────────────────

export type Role = "human" | "assistant";

export type ArtifactFormat = "tool_use" | "antartifact";

export interface Artifact {
  /** Stable id within this capture. */
  id: string;
  /** Human title if Claude gave one. */
  title?: string;
  /** Filename when present (e.g. "upload_handler.py"). */
  filename?: string;
  /** Language / mime hint ("python", "text/markdown", ...). */
  language?: string;
  /** Raw source content of the artifact (empty for binary deliverables). */
  content: string;
  /** Which on-wire format this came from. */
  format: ArtifactFormat;
  /** uuid of the message it appeared in. */
  messageUuid: string;
  /** Binary file (pdf/docx/image/…), never inline its content; attach it. */
  binary?: boolean;
  /** True when Claude formally presented this file to the user (a deliverable). */
  presented?: boolean;
}

export interface NormalizedMessage {
  uuid: string;
  role: Role;
  /** Plain text of the message (tool blocks stripped out into `artifacts`). */
  text: string;
  createdAt?: string;
}

/** A content block we could not classify. Surfaced loudly, never dropped. */
export interface UnknownBlock {
  messageUuid: string;
  /** The block's `type`/`name` if any, for debugging. */
  hint: string;
  /** A short, safe preview (truncated) so the user can see what we couldn't parse. */
  preview: string;
}

export interface IntegrityReport {
  totalBlocks: number;
  classifiedBlocks: number;
  unknown: UnknownBlock[];
  /** True only when every block was classified. */
  complete: boolean;
}

export interface UploadedFile {
  name: string;
  type?: string;
}

export interface NormalizedTranscript {
  conversationId: string;
  title: string;
  capturedAt: string; // ISO timestamp, injected by the caller (no Date.now in pure core)
  messages: NormalizedMessage[];
  artifacts: Artifact[];
  /** Files the user uploaded into the chat (from message attachments). */
  uploads: UploadedFile[];
  integrity: IntegrityReport;
}

// ─────────────────────────────────────────────────────────────────────────
// Brief state (distiller output).
// ─────────────────────────────────────────────────────────────────────────

export interface Decision {
  /** What was decided / locked. */
  text: string;
  /** What this decision replaced or superseded, if known. */
  replaces?: string;
}

export interface OpenThread {
  text: string;
}

export interface RejectedItem {
  /** The idea that was tried/considered. */
  idea: string;
  /** Why it was ruled out, the part nobody else carries. */
  why: string;
}

export type VerbatimKind =
  | "code"
  | "table"
  | "name"
  | "path"
  | "number"
  | "api"
  | "constraint";

export interface VerbatimItem {
  kind: VerbatimKind;
  /** Short label, e.g. "final upload handler" or "request timeout". */
  label: string;
  /** The exact value, byte-for-byte. */
  value: string;
  /** Language for code items. */
  language?: string;
}

export type FileSource = "chat" | "referenced";

export interface FileToAttach {
  /** Filename to attach. */
  name: string;
  /** One line: why it matters. */
  why: string;
  /** "chat": big thing produced in the chat. "referenced": mentioned, never shown. */
  source: FileSource;
}

export interface BriefState {
  /**
   * Where the conversation currently stands: 1-3 plain, present-tense sentences
   * stating what is being worked on at the latest point. Purely descriptive, no
   * advice and no suggested next step. The orientation a new chatbot reads first.
   */
  now: string;
  decided: Decision[];
  open: OpenThread[];
  rejected: RejectedItem[];
  verbatim: VerbatimItem[];
  filesToAttach: FileToAttach[];
  /** Provenance + honesty metadata. */
  meta: {
    conversationId: string;
    title: string;
    /** "deterministic" (Tier 0) or the model id used (Tier 2). */
    producedBy: string;
    /** Integrity carried through from capture so the UI can warn loudly. */
    integrity: IntegrityReport;
    /** Blocks/sections shown raw because they could not be distilled cleanly. */
    rawFallbacks: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Brief framings (brief renderer output), one engine, two framings.
// ─────────────────────────────────────────────────────────────────────────

export interface BriefFramings {
  /** Human-readable markdown for a teammate. */
  humanMarkdown: string;
  /** "Here's where we were, continue from here" framing for any chatbot. */
  resumePrompt: string;
  /** The intro line prepended to the resume prompt (shown to the user). */
  resumeHeader: string;
  /** The outro line appended to the resume prompt (shown to the user). */
  resumeFooter: string;
}
