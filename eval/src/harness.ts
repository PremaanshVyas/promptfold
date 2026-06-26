/**
 * The proof harness.
 *
 * Claim under test: a carrybot brief preserves everything *load-bearing* in a
 * conversation. Method (spec §9): give a fresh model ONLY the brief, and
 * separately the FULL chat, ask both the same next question, and check whether
 * the brief-only answer makes the same next move as the full-chat answer. If it
 * does, the brief kept what mattered.
 *
 * Runs in two modes:
 *   - no key:   reports brief shape + how much smaller it is than the full chat
 *               (the "shrinking is the value" claim, measured).
 *   - with key: also runs the same-next-move judgement with a real model.
 */

import {
  normalizeConversation,
  renderBrief,
  distillDeterministic,
  distillWithModel,
  renderTranscriptText,
  type LlmClient,
  type BriefState,
  type ClaudeConversation,
} from "@carrybot/core";

export interface Fixture {
  id: string;
  description: string;
  /** Raw Claude conversation payload (sanitized, no real user data). */
  conversation: ClaudeConversation;
  /** The question asked next, to both the brief-only and full-chat models. */
  nextQuestion: string;
}

export interface EvalEntry {
  id: string;
  description: string;
  fullChars: number;
  briefChars: number;
  /** How much smaller the brief is than the full chat (0..1). */
  reduction: number;
  integrityComplete: boolean;
  sections: {
    decided: number;
    open: number;
    rejected: number;
    verbatim: number;
    files: number;
  };
  judged?: {
    sameMove: boolean;
    reasoning: string;
  };
}

function sections(state: BriefState): EvalEntry["sections"] {
  return {
    decided: state.decided.length,
    open: state.open.length,
    rejected: state.rejected.length,
    verbatim: state.verbatim.length,
    files: state.filesToAttach.length,
  };
}

const RESUME_SYSTEM =
  "You are continuing someone else's project. You are given context, then a " +
  "question. Answer with the concrete next step you would take. Be specific.";

const JUDGE_SYSTEM =
  "You compare two answers to the same question about continuing a project. " +
  'Reply ONLY with JSON: {"sameMove": boolean, "reasoning": string}. ' +
  "sameMove is true if both answers would lead the project to the same next " +
  "action (ignoring wording). It is false if the brief-only answer misses, " +
  "contradicts, or re-opens something the full-chat answer got right.";

async function judgeSameMove(
  client: LlmClient,
  question: string,
  briefAnswer: string,
  fullAnswer: string,
): Promise<{ sameMove: boolean; reasoning: string }> {
  const out = await client.complete({
    system: JUDGE_SYSTEM,
    user:
      `Question: ${question}\n\n` +
      `Answer A (from the brief only):\n${briefAnswer}\n\n` +
      `Answer B (from the full chat):\n${fullAnswer}`,
    json: true,
  });
  try {
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    const parsed = JSON.parse(out.slice(start, end + 1)) as {
      sameMove?: boolean;
      reasoning?: string;
    };
    return {
      sameMove: Boolean(parsed.sameMove),
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return { sameMove: false, reasoning: "judge output did not parse: " + out.slice(0, 120) };
  }
}

export interface RunOptions {
  /** When provided, runs the full same-next-move judgement. */
  client?: LlmClient;
  capturedAt: string;
}

export async function runFixture(
  fixture: Fixture,
  opts: RunOptions,
): Promise<EvalEntry> {
  const transcript = normalizeConversation(fixture.conversation, {
    capturedAt: opts.capturedAt,
  });
  const fullText = renderTranscriptText(transcript);

  // Produce the brief (LLM if a key is configured, else deterministic Tier 0).
  const state: BriefState = opts.client
    ? (await distillWithModel(transcript, opts.client)).brief
    : distillDeterministic(transcript);
  const framings = renderBrief(state);

  const entry: EvalEntry = {
    id: fixture.id,
    description: fixture.description,
    fullChars: fullText.length,
    briefChars: framings.humanMarkdown.length,
    reduction:
      fullText.length > 0
        ? 1 - framings.humanMarkdown.length / fullText.length
        : 0,
    integrityComplete: state.meta.integrity.complete,
    sections: sections(state),
  };

  if (opts.client) {
    const [briefAnswer, fullAnswer] = await Promise.all([
      opts.client.complete({
        system: RESUME_SYSTEM,
        user: `Context (handoff brief):\n${framings.humanMarkdown}\n\nQuestion: ${fixture.nextQuestion}`,
      }),
      opts.client.complete({
        system: RESUME_SYSTEM,
        user: `Context (full conversation):\n${fullText}\n\nQuestion: ${fixture.nextQuestion}`,
      }),
    ]);
    entry.judged = await judgeSameMove(
      opts.client,
      fixture.nextQuestion,
      briefAnswer,
      fullAnswer,
    );
  }

  return entry;
}
