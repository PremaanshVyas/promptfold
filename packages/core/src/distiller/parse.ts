/**
 * Defensive parsing of model JSON into brief sections.
 *
 * Models wrap JSON in ```fences```, add prose, or drop a field. We extract the
 * JSON object, parse it, and coerce each section defensively. Anything missing
 * becomes an empty array — never a crash. If the text has no parseable object
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

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const VERBATIM_KINDS: ReadonlySet<string> = new Set([
  "code",
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
    throw new BriefParseError(
      `Model output was not valid JSON: ${(err as Error).message}`,
      text,
    );
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

  return { decided, open, rejected, verbatim, filesToAttach };
}
