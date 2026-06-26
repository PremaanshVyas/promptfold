/**
 * Defensive parsing of model JSON into brief sections.
 *
 * Models wrap JSON in ```fences```, add prose, or drop a field. We extract the
 * JSON object, parse it, and coerce each section defensively. Anything missing
 * becomes an empty array, never a crash. If the text has no parseable object
 * at all, we throw so the caller can record a loud raw fallback.
 */

import type {
  Decision,
  FileSource,
  FileToAttach,
  OpenThread,
  RejectedItem,
  VerbatimItem,
  VerbatimKind,
} from "../types.js";

export interface BriefSections {
  now: string;
  decided: Decision[];
  open: OpenThread[];
  rejected: RejectedItem[];
  verbatim: VerbatimItem[];
  filesToAttach: FileToAttach[];
}

export class BriefParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "BriefParseError";
  }
}

/** Pull the outermost JSON object out of a possibly-noisy model response. */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  // Strip a leading ```json / ``` fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new BriefParseError("No JSON object found in model output.", text);
  }
  return body.slice(start, end + 1);
}

/**
 * Salvage a truncated JSON object (the common failure when an LLM hits its
 * output cap mid-array). Walks string-aware, cuts after the last COMPLETE array
 * element, and closes any still-open arrays/objects. Returns valid JSON holding
 * every complete item, or null if nothing can be recovered.
 */
function salvageTruncatedJson(candidate: string): string | null {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  let lastElementEnd = -1;

  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      // A close while the enclosing container is an array = a finished element.
      if (stack[stack.length - 1] === "[") lastElementEnd = i + 1;
    }
  }
  if (lastElementEnd === -1) return null;

  const head = candidate.slice(0, lastElementEnd);

  // Recompute which containers remain open for `head`, then close them.
  let s2 = false;
  let e2 = false;
  const open: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (s2) {
      if (e2) e2 = false;
      else if (ch === "\\") e2 = true;
      else if (ch === '"') s2 = false;
      continue;
    }
    if (ch === '"') s2 = true;
    else if (ch === "{" || ch === "[") open.push(ch);
    else if (ch === "}" || ch === "]") open.pop();
  }
  let closed = head;
  for (let i = open.length - 1; i >= 0; i--) {
    closed += open[i] === "{" ? "}" : "]";
  }
  return closed;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const VERBATIM_KINDS: ReadonlySet<string> = new Set([
  "code",
  "table",
  "name",
  "path",
  "number",
  "api",
  "constraint",
]);

function coerceVerbatimKind(v: unknown): VerbatimKind {
  const s = asString(v);
  return (VERBATIM_KINDS.has(s) ? s : "constraint") as VerbatimKind;
}

export function parseBriefSections(text: string): BriefSections {
  const jsonText = extractJsonObject(text);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (err) {
    // Most often the model hit its output cap mid-array. Try to salvage every
    // complete item rather than throwing the whole thing away.
    const repaired = salvageTruncatedJson(jsonText);
    if (repaired) {
      try {
        obj = JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        throw new BriefParseError(
          `Model output was not valid JSON: ${(err as Error).message}`,
          text,
        );
      }
    } else {
      throw new BriefParseError(
        `Model output was not valid JSON: ${(err as Error).message}`,
        text,
      );
    }
  }

  const decided: Decision[] = asArray(obj["decided"])
    .map((d) => {
      const o = d as Record<string, unknown>;
      const replaces = asString(o["replaces"]);
      return {
        text: asString(o["text"]),
        ...(replaces ? { replaces } : {}),
      };
    })
    .filter((d) => d.text.length > 0);

  const open: OpenThread[] = asArray(obj["open"])
    .map((o) => ({ text: asString((o as Record<string, unknown>)["text"]) }))
    .filter((o) => o.text.length > 0);

  const rejected: RejectedItem[] = asArray(obj["rejected"])
    .map((r) => {
      const o = r as Record<string, unknown>;
      return { idea: asString(o["idea"]), why: asString(o["why"]) };
    })
    .filter((r) => r.idea.length > 0);

  const verbatim: VerbatimItem[] = asArray(obj["verbatim"])
    .map((v) => {
      const o = v as Record<string, unknown>;
      const language = asString(o["language"]);
      return {
        kind: coerceVerbatimKind(o["kind"]),
        label: asString(o["label"]),
        value: asString(o["value"]),
        ...(language ? { language } : {}),
      };
    })
    .filter((v) => v.value.length > 0);

  const filesToAttach: FileToAttach[] = asArray(obj["filesToAttach"])
    .map((f) => {
      const o = f as Record<string, unknown>;
      const source: FileSource =
        asString(o["source"]) === "referenced" ? "referenced" : "chat";
      return { name: asString(o["name"]), why: asString(o["why"]), source };
    })
    .filter((f) => f.name.length > 0);

  return { now: asString(obj["now"]), decided, open, rejected, verbatim, filesToAttach };
}
