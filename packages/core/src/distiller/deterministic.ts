/**
 * Tier 0 distiller — no key, no model, works everywhere.
 *
 * It cannot reason, so Decided/Open/Rejected stay empty (that needs an LLM,
 * Tier 2). What it CAN do is extract the exact, load-bearing facts with high
 * confidence and assemble the files-to-attach checklist — already a more
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
          ? "final deliverable presented in the chat (binary file) — attach it"
          : "binary file produced in the chat — attach it",
      });
    } else if (a.presented || a.content.length > BIG_CODE_CHARS) {
      files.push({
        name: a.filename ?? `${a.title ?? "artifact-" + a.id}`,
        source: "chat",
        why: a.presented
          ? `final deliverable presented to the user (${a.content.length} chars) — attach this file`
          : `final version produced in the chat (${a.content.length} chars) — attach the file rather than re-paste it inline`,
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
 * Filenames mentioned in text but never produced as an artifact in the chat →
 * "referenced" files to attach. This is the piece the spec calls out: the chat
 * only ever *referred* to your real upload_handler.py; tell the user to bring it.
 */
function referencedFiles(transcript: NormalizedTranscript): FileToAttach[] {
  const artifactNames = new Set(
    transcript.artifacts
      .map((a) => a.filename?.toLowerCase())
      .filter((n): n is string => Boolean(n)),
  );
  const mentioned = new Map<string, string>(); // lowercased → original casing
  const all = transcript.messages.map((m) => m.text).join("\n");
  for (const m of all.matchAll(FILENAME_RE)) {
    const name = m[1];
    if (!name) continue;
    const lower = name.toLowerCase();
    if (artifactNames.has(lower)) continue; // the chat actually contained it
    if (!mentioned.has(lower)) mentioned.set(lower, name);
  }
  return [...mentioned.values()].map((name) => ({
    name,
    source: "referenced" as const,
    why: "referred to in the chat but never shown in full — attach the real file so the next reader sees more than a snippet",
  }));
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

  const maxRef = opts.maxReferencedFiles ?? 25;
  const files = dedupe(
    [...fromArt.files, ...referencedFiles(transcript).slice(0, maxRef)],
    (f) => f.name.toLowerCase(),
  );

  return {
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
