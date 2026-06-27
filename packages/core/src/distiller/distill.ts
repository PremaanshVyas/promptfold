/**
 * Tier 2 orchestrator: captured transcript → structured brief via a BYOK model.
 *
 *   chunk → mini-brief per chunk → merge (latest-state-wins) → BriefState
 *
 * The LlmClient is injected, so this whole flow is unit-testable with a fake
 * model (no network, no key). Honest fallback: if the model's JSON can't be
 * parsed, we keep the deterministic Tier-0 facts for that data and record a
 * loud rawFallback instead of dropping anything.
 */

import type { BriefState, NormalizedTranscript } from "../types.js";
import { distillDeterministic, dedupeFilesByStem } from "./deterministic.js";
import { chunkTranscript, type ChunkOptions } from "./chunk.js";
import { parseBriefSections, BriefParseError } from "./parse.js";
import type { LlmClient } from "./llm.js";
import {
  chunkSystemPrompt,
  chunkUserPrompt,
  mergeSystemPrompt,
  mergeUserPrompt,
} from "./prompt.js";

export interface DistillOptions extends ChunkOptions {
  /** Carried into the brief so the UI can show provenance + warn loudly. */
  capturedAtNote?: string;
  /** Live progress for the UI: phase is "distilling" | "merging". */
  onProgress?: (done: number, total: number, phase: string) => void;
  /** How many chunk calls to run at once. Default 4. */
  concurrency?: number;
}

/** Run `task` over `items` with at most `limit` in flight; preserves order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export interface DistillResult {
  brief: BriefState;
  /** Number of chunks the transcript was split into. */
  chunks: number;
}

export async function distillWithModel(
  transcript: NormalizedTranscript,
  client: LlmClient,
  opts: DistillOptions = {},
): Promise<DistillResult> {
  // Tier-0 facts are always computed first: they are the safety net and they
  // carry the high-confidence verbatim/files even when the model is used.
  const deterministic = distillDeterministic(transcript);
  const rawFallbacks: string[] = [];

  const chunks = chunkTranscript(transcript, opts);
  if (chunks.length === 0) {
    return {
      brief: {
        ...deterministic,
        meta: { ...deterministic.meta, producedBy: client.id },
      },
      chunks: 0,
    };
  }

  // 1) Distill each chunk into a mini-brief, running several at once so a long
  // chat finishes in seconds, not minutes. Order is preserved for the merge.
  let completed = 0;
  opts.onProgress?.(0, chunks.length, "distilling");
  const perChunk = await mapLimit(
    chunks,
    opts.concurrency ?? 4,
    async (chunk, i) => {
      try {
        const out = await client.complete({
          system: chunkSystemPrompt(),
          user: chunkUserPrompt(chunk, i, chunks.length),
          json: true,
        });
        parseBriefSections(out); // validate it parses
        return { ok: true as const, out };
      } catch (err) {
        return { ok: false as const, message: (err as Error).message, index: i };
      } finally {
        completed += 1;
        opts.onProgress?.(completed, chunks.length, "distilling");
      }
    },
  );

  const miniBriefs: string[] = [];
  for (const r of perChunk) {
    if (r.ok) miniBriefs.push(r.out);
    else
      rawFallbacks.push(
        `Chunk ${r.index + 1}/${chunks.length} did not parse (${r.message}); its raw model output was kept out of the merge.`,
      );
  }

  // 2) Merge (or take the single mini-brief). Enforce latest-state-wins.
  let finalSections;
  if (miniBriefs.length === 0) {
    // Model produced nothing usable, degrade to deterministic, loudly.
    rawFallbacks.push(
      "No chunk produced parseable JSON; fell back to deterministic extraction.",
    );
    return {
      brief: {
        ...deterministic,
        meta: {
          ...deterministic.meta,
          producedBy: `${client.id} (fallback: deterministic)`,
          rawFallbacks,
        },
      },
      chunks: chunks.length,
    };
  } else if (miniBriefs.length === 1) {
    finalSections = parseBriefSections(miniBriefs[0] ?? "");
  } else {
    opts.onProgress?.(0, 1, "merging");
    const merged = await client.complete({
      system: mergeSystemPrompt(),
      user: mergeUserPrompt(miniBriefs),
      json: true,
    });
    opts.onProgress?.(1, 1, "merging");
    try {
      finalSections = parseBriefSections(merged);
    } catch (err) {
      // Merge failed to parse: use the last mini-brief (latest state) + warn.
      rawFallbacks.push(
        `Merge step did not parse (${
          (err as Error).message
        }); used the final chunk's brief as the resolved state.`,
      );
      finalSections = parseBriefSections(miniBriefs[miniBriefs.length - 1] ?? "");
    }
  }

  // 3) Reconcile files-to-attach: the deterministic reconstruction is
  // authoritative for files the chat produced; the model may add referenced
  // ones. Union, then dedupe by STEM so the same file under different
  // paths/extensions collapses to one (prefers the real produced file).
  finalSections.filesToAttach = dedupeFilesByStem([
    ...deterministic.filesToAttach,
    ...finalSections.filesToAttach,
  ]);

  // 3b) Strip self-referential meta-commentary. When this brief (or feedback
  // about it) is pasted INTO a chat that is later summarized, the model captures
  // remarks about the tool as if they were conversational state. The prompt asks
  // it not to, but that is unreliable, so we deterministically drop items that
  // are clearly about the brief/tool rather than the work.
  const META_RE =
    /\bhandoff tool\b|\bsummary tool\b|\bin (the )?handoff\b|\b(now|verbatim|rejected|decided|open)\s+section\b|\battach(ment)? list\b|\bundercount(s|ed|ing)?\b|\bextractor\b|\bdistiller\b|\bthe handoff\b/i;
  const isMeta = (s: string): boolean => META_RE.test(s);
  finalSections.decided = finalSections.decided.filter((d) => !isMeta(d.text));
  finalSections.open = finalSections.open.filter((o) => !isMeta(o.text));
  finalSections.rejected = finalSections.rejected.filter(
    (r) => !isMeta(r.idea) && !isMeta(r.why),
  );

  // 4) GUARANTEE structured content: the model often summarizes a table into
  // prose or drops an image. Every table and image deterministically found in
  // the chat is force-added to verbatim, regardless of what the model returned.
  // This is the "without fail" path for content types that must never vanish.
  // Dedup is FUZZY for tables: the model often reproduces the same table
  // reformatted or with a row added/removed, so an exact key would let a
  // near-duplicate slip through. We compare token overlap and skip if the model
  // already has a substantially-equivalent table.
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/[^a-z0-9.%$]+/).filter((t) => t.length > 0));
  const overlap = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared += 1;
    return shared / Math.min(a.size, b.size);
  };
  const existingTables = finalSections.verbatim
    .filter((v) => v.kind === "table")
    .map((v) => tokenize(v.value));
  const existingImages = new Set(
    finalSections.verbatim.filter((v) => v.kind === "image").map((v) => v.value.toLowerCase().trim()),
  );
  for (const v of deterministic.verbatim) {
    if (v.kind === "image") {
      if (!existingImages.has(v.value.toLowerCase().trim())) {
        finalSections.verbatim.push(v);
        existingImages.add(v.value.toLowerCase().trim());
      }
    } else if (v.kind === "table") {
      const sig = tokenize(v.value);
      if (!existingTables.some((e) => overlap(sig, e) >= 0.8)) {
        finalSections.verbatim.push(v);
        existingTables.push(sig);
      }
    }
  }

  // 5) GUARANTEE the deliverable count in "now". The state line must not
  // undercount the files the chat produced (for a multi-file build the file
  // count IS the state). If "now" does not already name every produced file, we
  // append a factual list, deterministically, so a reader never thinks a missing
  // file has yet to be made.
  const produced = finalSections.filesToAttach
    .filter((f) => f.source === "chat")
    .map((f) => f.name);
  if (produced.length >= 2) {
    const nowLc = finalSections.now.toLowerCase();
    const allNamed = produced.every((n) => nowLc.includes(n.toLowerCase()));
    if (!allNamed) {
      const prefix = finalSections.now.trim() ? finalSections.now.trim() + " " : "";
      finalSections.now = `${prefix}Files produced in this chat (${produced.length}): ${produced.join(", ")}.`;
    }
  }

  return {
    brief: {
      now: finalSections.now,
      decided: finalSections.decided,
      open: finalSections.open,
      rejected: finalSections.rejected,
      verbatim: finalSections.verbatim,
      filesToAttach: finalSections.filesToAttach,
      meta: {
        conversationId: transcript.conversationId,
        title: transcript.title,
        producedBy: client.id,
        integrity: transcript.integrity,
        rawFallbacks,
      },
    },
    chunks: chunks.length,
  };
}

export { distillDeterministic, BriefParseError };
