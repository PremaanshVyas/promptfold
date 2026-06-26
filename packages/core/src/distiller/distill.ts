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
import { distillDeterministic } from "./deterministic.js";
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

  // 1) Distill each chunk into a mini-brief (raw JSON string).
  const miniBriefs: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const out = await client.complete({
      system: chunkSystemPrompt(),
      user: chunkUserPrompt(chunks[i] ?? "", i, chunks.length),
      json: true,
    });
    // Validate it parses; if not, record loudly but keep going.
    try {
      parseBriefSections(out);
      miniBriefs.push(out);
    } catch (err) {
      rawFallbacks.push(
        `Chunk ${i + 1}/${chunks.length} did not parse (${
          (err as Error).message
        }); its raw model output was kept out of the merge.`,
      );
    }
  }

  // 2) Merge (or take the single mini-brief). Enforce latest-state-wins.
  let finalSections;
  if (miniBriefs.length === 0) {
    // Model produced nothing usable — degrade to deterministic, loudly.
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
    const merged = await client.complete({
      system: mergeSystemPrompt(),
      user: mergeUserPrompt(miniBriefs),
      json: true,
    });
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

  // 3) Union the model's files-to-attach with the deterministic referenced-file
  // detector — the model can miss a file the regex catches, and vice versa.
  const fileNames = new Set(
    finalSections.filesToAttach.map((f) => f.name.toLowerCase()),
  );
  for (const f of deterministic.filesToAttach) {
    if (!fileNames.has(f.name.toLowerCase())) {
      finalSections.filesToAttach.push(f);
      fileNames.add(f.name.toLowerCase());
    }
  }

  return {
    brief: {
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
