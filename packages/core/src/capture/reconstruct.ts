/**
 * File reconstruction, replay the sandbox file tools in order to compute each
 * file's TRUE final content and name, then pick the real deliverables.
 *
 * Why: a chat builds draft.md → edits it with str_replace → copies it to
 * /mnt/user-data/outputs/final-name.txt → present_files it. Reading each
 * create_file snapshot separately gave 5 stale drafts and the wrong "final"
 * name. Replaying gives ONE file, fully edited, under its real delivered name.
 *
 * Deliverable signal (from Anthropic's sandbox semantics):
 *   1. present_files.filepaths . Claude's explicit "here are your files" manifest.
 *   2. else: files under /mnt/user-data/outputs/ (the canonical outputs dir).
 *   3. else: nothing was formally delivered, fall back to all written files.
 */

import type { ClaudeContentBlock } from "../types.js";
import { isBinaryFile } from "./file-types.js";

const OUTPUTS_DIR = "/mnt/user-data/outputs/";

export interface ReconstructedFile {
  /** Absolute path as last written. */
  path: string;
  /** Basename, e.g. "the-stubborn-weight-of-being-human.txt". */
  name: string;
  /** Final text content ("" for binary or unresolved files). */
  content: string;
  binary: boolean;
  presented: boolean;
}

export interface ReconstructResult {
  /** The files a continuer should actually take. */
  deliverables: ReconstructedFile[];
}

// ── path helpers ──────────────────────────────────────────────────────────

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/** Resolve `path` against `cwd` (both posix-ish). Strips surrounding quotes. */
function resolvePath(cwd: string, path: string): string {
  const p = path.replace(/^['"]|['"]$/g, "");
  if (p.startsWith("/")) return normalize(p);
  return normalize((cwd.endsWith("/") ? cwd : cwd + "/") + p);
}

function normalize(p: string): string {
  const segs = p.split("/");
  const out: string[] = [];
  for (const s of segs) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return "/" + out.join("/");
}

/** Split a bash line into subcommands, then each into quote-aware tokens. */
function tokenizeCommand(cmd: string): string[][] {
  const subs = cmd.split(/&&|;|\n/);
  return subs.map((sub) => {
    const tokens: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sub)) !== null) {
      tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
    }
    return tokens;
  });
}

// ── the engine ────────────────────────────────────────────────────────────

interface Engine {
  files: Map<string, string>;
  order: string[]; // paths in last-write order
  cwd: string;
  presented: string[];
}

function touch(eng: Engine, path: string, content: string): void {
  eng.files.set(path, content);
  eng.order = eng.order.filter((p) => p !== path);
  eng.order.push(path);
}

function applyStrReplace(eng: Engine, path: string, oldStr: string, newStr: string): void {
  const cur = eng.files.get(path);
  if (cur === undefined) return;
  const idx = cur.indexOf(oldStr);
  if (idx === -1) return; // exact match required; ignore if absent (no-op edits exist)
  touch(eng, path, cur.slice(0, idx) + newStr + cur.slice(idx + oldStr.length));
}

function applyInsert(eng: Engine, path: string, line: number, text: string): void {
  const cur = eng.files.get(path) ?? "";
  const lines = cur.split("\n");
  lines.splice(Math.max(0, line), 0, text);
  touch(eng, path, lines.join("\n"));
}

function runBash(eng: Engine, command: string): void {
  for (const tokens of tokenizeCommand(command)) {
    if (tokens.length === 0) continue;
    const cmd = tokens[0];
    if (cmd === "cd" && tokens[1]) {
      eng.cwd = resolvePath(eng.cwd, tokens[1]);
    } else if (cmd === "cp" || cmd === "mv") {
      const args = tokens.slice(1).filter((t) => !t.startsWith("-"));
      if (args.length >= 2) {
        const src = resolvePath(eng.cwd, args[0]!);
        const dest = resolvePath(eng.cwd, args[args.length - 1]!);
        const content = eng.files.get(src);
        if (content !== undefined) touch(eng, dest, content);
        if (cmd === "mv") {
          eng.files.delete(src);
          eng.order = eng.order.filter((p) => p !== src);
        }
      }
    } else if (cmd === "rm") {
      for (const a of tokens.slice(1)) {
        if (a.startsWith("-")) continue;
        const p = resolvePath(eng.cwd, a);
        eng.files.delete(p);
        eng.order = eng.order.filter((x) => x !== p);
      }
    }
    // mkdir, python, echo, etc.: ignored, content comes from create/edit ops.
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Replay all file tool_use blocks (in conversation order) and pick deliverables. */
export function reconstructFiles(toolBlocks: ClaudeContentBlock[]): ReconstructResult {
  const eng: Engine = { files: new Map(), order: [], cwd: "/home/claude", presented: [] };

  for (const b of toolBlocks) {
    const name = typeof b.name === "string" ? b.name : "";
    const input = (b.input ?? {}) as Record<string, unknown>;
    const command = str(input["command"]);
    const path = str(input["path"]);

    // create_file (claude.ai) OR text-editor "create"
    if ((name === "create_file" || command === "create") && path) {
      const fileText = str(input["file_text"]);
      if (fileText !== undefined) touch(eng, resolvePath(eng.cwd, path), fileText);
    } else if ((name === "str_replace" || command === "str_replace") && path) {
      applyStrReplace(
        eng,
        resolvePath(eng.cwd, path),
        str(input["old_str"]) ?? "",
        str(input["new_str"]) ?? "",
      );
    } else if ((name === "insert" || command === "insert") && path) {
      applyInsert(
        eng,
        resolvePath(eng.cwd, path),
        typeof input["insert_line"] === "number" ? (input["insert_line"] as number) : 0,
        str(input["insert_text"]) ?? str(input["new_str"]) ?? "",
      );
    } else if (name === "bash_tool" || name === "bash" || command === "bash") {
      const c = str(input["command"]);
      if (c) runBash(eng, c);
    } else if (name === "present_files") {
      const fp = input["filepaths"] ?? input["file_paths"];
      if (Array.isArray(fp)) {
        eng.presented = fp.filter((p): p is string => typeof p === "string");
      }
    }
  }

  // Choose the deliverable set.
  const presentedSet = new Set(eng.presented.map((p) => resolvePath("/", p)));
  let paths: string[];
  if (presentedSet.size > 0) {
    paths = [...presentedSet];
  } else {
    paths = [...eng.files.keys()].filter((p) => p.startsWith(OUTPUTS_DIR));
    if (paths.length === 0) paths = [...eng.files.keys()]; // nothing formally delivered
  }

  const lastWritten = eng.order[eng.order.length - 1];
  const deliverables: ReconstructedFile[] = paths.map((p) => {
    const binary = isBinaryFile(p);
    // Content: the file at this path; if a presented path has no captured content
    // (e.g. produced by code we can't replay), fall back to the last written file.
    let content = eng.files.get(p) ?? "";
    if (!content && !binary && lastWritten) content = eng.files.get(lastWritten) ?? "";
    return {
      path: p,
      name: basename(p),
      content: binary ? "" : content,
      binary,
      presented: presentedSet.has(p),
    };
  });

  return { deliverables };
}
