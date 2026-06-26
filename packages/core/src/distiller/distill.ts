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

  // 4) GUARANTEE tables: the model often summarizes a table into prose. Every
  // markdown table actually present in the chat is force-added to verbatim,
  // regardless of what the model returned. This is the "without fail" path.
  const tableKey = (v: string) => v.replace(/\s+/g, "");
  const haveTable = new Set(
    finalSections.verbatim.filter((v) => v.kind === "table").map((v) => tableKey(v.value)),
  );
  for (const v of deterministic.verbatim) {
    if (v.kind === "table" && !haveTable.has(tableKey(v.value))) {
      finalSections.verbatim.push(v);
      haveTable.add(tableKey(v.value));
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
