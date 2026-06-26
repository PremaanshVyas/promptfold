/**
 * Service worker — the only place the BYOK key is read and used.
 *
 * Receives a captured transcript from the content script, distills it, and
 * returns both framings. With a key → Tier 2 (full structured brief). Without a
 * key → Tier 0 (deterministic, still useful). Either way, nothing leaves the
 * machine except the call to the user's chosen provider.
 */

import {
  distillWithModel,
  distillDeterministic,
  makeLlmClient,
  renderBrief,
} from "@carrybot/core";
import type { DistillRequest, WorkerResponse } from "../shared/messages.js";
import { loadSettings, hasKey } from "../shared/settings.js";

async function handleDistill(req: DistillRequest): Promise<WorkerResponse> {
  const settings = await loadSettings();
  try {
    if (hasKey(settings)) {
      const client = makeLlmClient({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
      });
      const { brief } = await distillWithModel(req.transcript, client);
      return {
        type: "brief",
        framings: renderBrief(brief),
        state: brief,
        producedBy: brief.meta.producedBy,
      };
    }
    // Tier 0 — no key, still a complete, useful handoff.
    const brief = distillDeterministic(req.transcript);
    return {
      type: "brief",
      framings: renderBrief(brief),
      state: brief,
      producedBy: brief.meta.producedBy,
    };
  } catch (err) {
    return { type: "error", message: (err as Error).message };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const req = message as { type?: string };
  if (req?.type === "distill") {
    handleDistill(message as DistillRequest).then(sendResponse);
    return true; // keep the channel open for the async response
  }
  return false;
});
