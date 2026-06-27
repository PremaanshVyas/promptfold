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

import { BRIEF_SCHEMA_VERSION } from "../types.js";
import type {
  Artifact,
  BriefState,
  FileToAttach,
  NormalizedTranscript,
  VerbatimItem,
} from "../types.js";
import { collapseArtifactLineage } from "./dedupe.js";
import { basenameOf, isSandboxPath, stemOf } from "../capture/shared/file-types.js";

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
    } else if (a.presented || a.content.length > BIG_CODE_CHARS || a.messageUuid === "reconstructed") {
      // A reconstructed file is a real produced deliverable, attach it whatever
      // its size, so files created in the same chat are classified consistently
      // (never some inline and some attached). Describe size qualitatively only:
      // we never read the real file off disk, so an invented byte/char count
      // would erode trust faster than no number at all.
      files.push({
        name: a.filename ?? `${a.title ?? "artifact-" + a.id}`,
        source: "chat",
        why: a.presented
          ? "final deliverable presented to the user, attach this file"
          : "produced in the chat, attach the file so the next reader has the original",
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

/**
 * Pull every markdown table out of a text. A table is a row with `|`, followed
 * by a separator row (`| --- | --- |`), followed by data rows. Platform-agnostic:
 * tables are inline markdown on every chatbot, so this finds them in any chat.
 */
export function extractMarkdownTables(text: string): string[] {
  const lines = text.split("\n");
  const tables: string[] = [];
  const isSep = (l: string) => /^[\s|:-]+$/.test(l) && l.includes("-") && l.includes("|");
  let i = 0;
  while (i < lines.length) {
    const header = lines[i] ?? "";
    if (header.includes("|") && isSep(lines[i + 1] ?? "")) {
      const block = [header.trim(), (lines[i + 1] ?? "").trim()];
      let j = i + 2;
      while (j < lines.length && (lines[j] ?? "").includes("|") && (lines[j] ?? "").trim() !== "") {
        block.push((lines[j] ?? "").trim());
        j++;
      }
      if (block.length >= 3) tables.push(block.join("\n")); // header + sep + ≥1 row
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

/** Tables from messages AND produced artifacts (canvas docs), deduped. */
function fromTables(
  transcript: NormalizedTranscript,
  artifacts: Artifact[],
): VerbatimItem[] {
  const items: VerbatimItem[] = [];
  const seen = new Set<string>();
  const sources = [
    ...transcript.messages.map((m) => m.text),
    ...artifacts.map((a) => a.content),
  ];
  for (const text of sources) {
    for (const table of extractMarkdownTables(text)) {
      const key = table.replace(/\s+/g, "");
      if (key.length < 12 || seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: "table", label: "table", value: table });
    }
  }
  return items;
}

// Spreadsheet / cell formula, with an optional target cell: B12=B5+B6+B7 or
// =B2/B3. Captures the "Bxx=" prefix when present so the cell is named, exactly
// as the file has it. NOT an API endpoint.
const FORMULA_RE =
  /(?:\b[A-Z]{1,3}\$?\d{1,4}\s*=\s*|=\s*)[A-Z]{1,3}\$?\d{1,4}(?:\s*[-+*/]\s*\$?[A-Z]{1,3}\$?\d{1,4})+/g;

/**
 * Record that an image was SHOWN, by its subject, from the STRUCTURED
 * `message.images` captured at the data layer, never by scanning text. Scanning
 * text re-ingested the tool's own markers when a brief was pasted back into a
 * chat (a round-2 image reappearing in round 5). Latest-state-wins: only the
 * most recent image-showing turn is current state, so we emit just that one,
 * which also prevents prior turns' images from bleeding in. URL is never stored.
 */
function fromImages(transcript: NormalizedTranscript): VerbatimItem[] {
  let latest: string[] | undefined;
  for (const m of transcript.messages) {
    if (m.images && m.images.length > 0) latest = m.images;
  }
  if (!latest) return [];
  const seen = new Set<string>();
  const items: VerbatimItem[] = [];
  for (const subject of latest) {
    const v = subject.trim() || "image";
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind: "image", label: "image shown", value: v });
  }
  return items;
}

/** Spreadsheet/cell formulas → one verbatim "constraint" each, kept separate. */
function fromFormulas(transcript: NormalizedTranscript): VerbatimItem[] {
  const items: VerbatimItem[] = [];
  const all = transcript.messages.map((m) => m.text).join("\n");
  for (const m of all.matchAll(FORMULA_RE)) {
    items.push({ kind: "constraint", label: "formula", value: m[0].replace(/\s+/g, "") });
  }
  return dedupe(items, (i) => i.value);
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

// A file generated into ChatGPT's sandbox, referenced by its session-local path:
// sandbox:/mnt/data/Report.docx, or a bare /mnt/data/... path. (Claude's
// /mnt/user-data/outputs files are reconstructed into deliverables separately,
// so they are deliberately NOT matched here.)
const SANDBOX_FILE_RE = /(?:sandbox:)?\/mnt\/data\/([^\s)"'`\]]+\.\w{1,5})/g;

/**
 * Files generated in a model sandbox and referenced only by their session-local
 * path (e.g. ChatGPT's `sandbox:/mnt/data/Report.docx`). Capture them by NAME
 * with a clear status, never the brittle path, which does not exist in a new
 * chat. This is the "treat generated files as artifacts, not paths" fix.
 */
function fromGeneratedFiles(transcript: NormalizedTranscript): FileToAttach[] {
  const seen = new Set<string>();
  const out: FileToAttach[] = [];
  const all = transcript.messages.map((m) => m.text).join("\n");
  for (const m of all.matchAll(SANDBOX_FILE_RE)) {
    const base = basenameOf(m[1] ?? "");
    if (!base || seen.has(base.toLowerCase())) continue;
    seen.add(base.toLowerCase());
    out.push({
      name: base,
      source: "chat",
      why: "generated in the previous session; its sandbox path is session-local and will not exist in a new chat, so regenerate it or attach the saved copy",
    });
  }
  return out;
}

/** A web URL/host like www.nutritionvalue.org/x.html, NOT a file the user made. */
function looksLikeUrl(name: string): boolean {
  const firstSeg = (name.split("/")[0] ?? "").replace(/^https?:\/\//i, "");
  // A multi-label domain host (label(.label)*.tld) before the first slash. Real
  // paths ("services/auth.py", "./config.yaml") have no dotted host there.
  return name.includes("/") && /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(firstSeg);
}

/**
 * Filenames mentioned in text but never produced in the chat → "referenced"
 * files to attach (e.g. your real upload_handler.py the chat only saw a snippet
 * of). Excludes sandbox-internal paths (/mnt/user-data, /home/claude, /tmp),
 * which file reconstruction already handles, web URLs (a link that flew by is
 * not an attachable file), and anything sharing a STEM with a produced artifact.
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
    if (looksLikeUrl(name)) continue; // a link, not a file you can attach
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
 * Reconcile a files-to-attach list:
 *   - keep EVERY distinct produced ("chat") file, deduped by full name, so a
 *     report delivered as both report.docx and report.pdf keeps BOTH (they are
 *     separate deliverables, not a working copy of one another);
 *   - drop a "referenced" mention whose STEM matches a produced file (the chat
 *     made the real thing, the mention is redundant), and dedupe the remaining
 *     referenced mentions by stem.
 */
export function dedupeFilesByStem(files: FileToAttach[]): FileToAttach[] {
  // Safety net: never present a session-local sandbox path as a file name (it
  // will not exist in a new chat). Show the basename only.
  files = files.map((f) =>
    isSandboxPath(f.name) ? { ...f, name: basenameOf(f.name) } : f,
  );
  const producedStems = new Set(
    files.filter((f) => f.source === "chat").map((f) => stemOf(f.name)),
  );
  const out: FileToAttach[] = [];
  const seenChatName = new Set<string>();
  const seenRefStem = new Set<string>();
  for (const f of files) {
    if (f.source === "chat") {
      const key = f.name.toLowerCase();
      if (seenChatName.has(key)) continue;
      seenChatName.add(key);
      out.push(f);
    } else {
      const stem = stemOf(f.name);
      if (producedStems.has(stem)) continue; // a produced file already covers it
      if (seenRefStem.has(stem)) continue;
      seenRefStem.add(stem);
      out.push(f);
    }
  }
  return out;
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
      ...fromTables(transcript, artifacts),
      ...fromImages(transcript),
      ...fromFormulas(transcript),
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
    ...fromGeneratedFiles(transcript),
    ...uploadFiles,
    ...referencedFiles(transcript).slice(0, maxRef),
  ]);

  // A factual "now" with no reasoning (Tier 0 cannot reason): message count and
  // the files produced. This is what the no-key brief shows at its head.
  const produced = files.filter((f) => f.source === "chat").map((f) => f.name);
  const now =
    `Captured this conversation (${transcript.messages.length} messages).` +
    (produced.length > 0 ? ` Files produced: ${produced.join(", ")}.` : "");

  return {
    now,
    decided: [],
    open: [],
    rejected: [],
    verbatim,
    filesToAttach: files,
    meta: {
      conversationId: transcript.conversationId,
      title: transcript.title,
      producedBy: "deterministic",
      schemaVersion: BRIEF_SCHEMA_VERSION,
      generatedAt: transcript.capturedAt,
      integrity: transcript.integrity,
      rawFallbacks: [],
    },
  };
}
