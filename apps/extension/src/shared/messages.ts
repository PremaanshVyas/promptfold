/**
 * Message protocol between the content script and the service worker.
 *
 * Split of responsibility:
 *   - content script: same-origin capture from claude.ai (needs the session
 *     cookie, which only a claude.ai context has) + rendering the drawer.
 *   - worker: the BYOK LLM call (so the API key stays out of the page context).
 */

import type { BriefFramings, BriefState, NormalizedTranscript } from "@carrybot/core";

export interface DistillRequest {
  type: "distill";
  transcript: NormalizedTranscript;
}

export interface DistillResponse {
  type: "brief";
  framings: BriefFramings;
  state: BriefState;
  /** "deterministic" (Tier 0) or the model id (Tier 2). */
  producedBy: string;
}

export interface ProgressResponse {
  type: "progress";
  done: number;
  total: number;
  phase: string;
}

export interface ErrorResponse {
  type: "error";
  message: string;
}

export type WorkerResponse = DistillResponse | ProgressResponse | ErrorResponse;
