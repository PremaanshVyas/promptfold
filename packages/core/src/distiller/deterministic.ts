/**
 * Tier 0 distiller, no key, no model, works everywhere.
 *
 * It cannot reason, so Decided/Open/Rejected stay empty (that needs an LLM,
 * Tier 2). What it CAN do is extract the exact, load-bearing facts with high
 * confidence and assemble the files-to-attach checklist, already a more
 * complete handoff than the popular free exporters ship.
 *
 * Pure and deterministic: same transcript in → same brief out.
 */

import type {
  Artifact,
  BriefState,
  FileToAttach,
  NormalizedTranscript,
  VerbatimItem,
} from "../types.js";
import { collapseArtifactLineage } from "./dedupe.js";
import { isSandboxPath, stemOf } from "../capture/file-types.js";

/** Above this, code is better attached as a file than pasted inline. */
const BIG_CODE_CHARS = 1500;

const FENCE_RE = /```([\w.+-]*)\n([\s\S]*?)```/g;
const HTTP_RE = /\bhttps?:\/\/[^\s"'`<>)]+/g;
const REST_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s"'`<>)]+)/g;
// A token that looks like a real filename: name + known-ish extension.
const FILENAME_RE =
  /\b([\w./-]+\.(?:ts|tsx|js|jsx|py|rb|go|rs|java|kt|c|cpp|h|cs|php|swift|sql|json|ya?ml|toml|md|txt|env|sh|html|css|scss))\b/g;

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

function artifactLabel(a: Artifact): string {
  return a.filename ?? a.title ?? `artifact ${a.id}`;
}

/** Split artifacts into small (inline verbatim) and big (attach as file). */
function fromArtifacts(artifacts: Artifact[]): {
  verbatim: VerbatimItem[];
  files: FileToAttach[];
} {
  const verbatim: VerbatimItem[] = [];
  const files: FileToAttach[] = [];
  for (const a of artifacts) {
    if (a.binary) {
      files.push({
        name: a.filename ?? `artifact-${a.id}`,
        source: "chat",
        why: a.presented
          ? "final deliverable presented in the chat (binary file), attach it"
          : "binary file produced in the chat, attach it",
      });
    } else if (a.presented || a.content.length > BIG_CODE_CHARS) {
      files.push({
        name: a.filename ?? `${a.title ?? "artifact-" + a.id}`,
        source: "chat",
        why: a.presented
          ? `final deliverable presented to the user (${a.content.length} chars), attach this file`
          : `final version produced in the chat (${a.content.length} chars), attach the file rather than re-paste it inline`,
      });
    } else {
      verbatim.push({
        kind: "code",
        label: artifactLabel(a),
        value: a.content,
        ...(a.language ? { language: a.language } : {}),
      });
    }
  }
  return { verbatim, files };
}

/** Inline fenced code blocks in message text → verbatim code (deduped). */
function fromFencedCode(transcript: NormalizedTranscript): VerbatimItem[] {
  const items: VerbatimItem[] = [];
  for (const m of transcript.messages) {
    FENCE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FENCE_RE.exec(m.text)) !== null) {
      const lang = match[1] ?? "";
      const code = (match[2] ?? "").trim();
      if (code.length < 12) continue; // skip trivial snippets
      if (code.length > BIG_CODE_CHARS) continue; // big code handled via artifacts
      items.push({
        kind: "code",
        label: lang ? `${lang} snippet` : "code snippet",
        value: code,
        ...(lang ? { language: lang } : {}),
      });
    }
  }
  // Keep each unique code body once; later identical ones are the same final state.
  return dedupe(items, (i) => i.value);
}

/** URLs and REST-style endpoints mentioned anywhere → verbatim api items. */
function fromApiMentions(transcript: NormalizedTranscript): VerbatimItem[] {
  const items: VerbatimItem[] = [];
  const all = transcript.messages.map((m) => m.text).join("\n");
  for (const m of all.matchAll(HTTP_RE)) {
    items.push({ kind: "api", label: "url", value: m[0] });
  }
  for (const m of all.matchAll(REST_RE)) {
    items.push({ kind: "api", label: "endpoint", value: `${m[1]} ${m[2]}` });
  }
  return dedupe(items, (i) => i.value);
}

/**
 * Filenames mentioned in text but never produced in the chat → "referenced"
 * files to attach (e.g. your real upload_handler.py the chat only saw a snippet
 * of). Excludes sandbox-internal paths (/mnt/user-data, /home/claude, /tmp),
 * which file reconstruction already handles, and anything sharing a STEM with a
 * produced artifact.
 */
function referencedFiles(transcript: NormalizedTranscript): FileToAttach[] {
  const artifactStems = new Set(
    transcript.artifacts
      .map((a) => (a.filename ? stemOf(a.filename) : ""))
      .filter(Boolean),
  );
  const mentioned = new Map<string, string>(); // stem → display name
  const all = transcript.messages.map((m) => m.text).join("\n");
  for (const m of all.matchAll(FILENAME_RE)) {
    const name = m[1];
    if (!name) continue;
    if (isSandboxPath(name)) continue; // internal working path, not a user file
    const stem = stemOf(name);
    if (artifactStems.has(stem)) continue; // the chat actually produced it
    if (!mentioned.has(stem)) mentioned.set(stem, name); // keep the helpful path
  }
  return [...mentioned.values()].map((name) => ({
    name,
    source: "referenced" as const,
    why: "referred to in the chat but never shown in full, attach the real file so the next reader sees more than a snippet",
  }));
}

/**
 * Dedupe a files-to-attach list by STEM (so essay.md / essay.txt / a working
 * copy collapse to one), preferring a "chat" deliverable over a "referenced"
 * mention.
 */
export function dedupeFilesByStem(files: FileToAttach[]): FileToAttach[] {
  const byStem = new Map<string, FileToAttach>();
  for (const f of files) {
    const stem = stemOf(f.name);
    const existing = byStem.get(stem);
    if (!existing) {
      byStem.set(stem, f);
    } else if (existing.source === "referenced" && f.source === "chat") {
      byStem.set(stem, f); // a real produced file beats a referenced mention
    }
  }
  return [...byStem.values()];
}

export interface DeterministicOptions {
  /** Cap on referenced-file suggestions to avoid noise on huge chats. */
  maxReferencedFiles?: number;
}

/** Produce a Tier-0 brief state from a captured transcript. */
export function distillDeterministic(
  transcript: NormalizedTranscript,
  opts: DeterministicOptions = {},
): BriefState {
  // Collapse evolving draft lineages to the latest version before listing them.
  const artifacts = collapseArtifactLineage(transcript.artifacts);
  const fromArt = fromArtifacts(artifacts);
  const verbatim = dedupe(
    [
      ...fromArt.verbatim,
      ...fromFencedCode(transcript),
      ...fromApiMentions(transcript),
    ],
    (i) => `${i.kind}:${i.value}`,
  );

  // Files the user uploaded are authoritative "bring these" items.
  const uploadFiles: FileToAttach[] = transcript.uploads.map((u) => ({
    name: u.name,
    source: "referenced",
    why: "you uploaded this to the chat, attach it so the next reader has the original",
  }));

  const maxRef = opts.maxReferencedFiles ?? 25;
  const files = dedupeFilesByStem([
    ...fromArt.files,
    ...uploadFiles,
    ...referencedFiles(transcript).slice(0, maxRef),
  ]);

  return {
    now: "",
    decided: [],
    open: [],
    rejected: [],
    verbatim,
    filesToAttach: files,
    meta: {
      conversationId: transcript.conversationId,
      title: transcript.title,
      producedBy: "deterministic",
      integrity: transcript.integrity,
      rawFallbacks: [],
    },
  };
}
