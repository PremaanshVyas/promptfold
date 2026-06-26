/**
 * Service worker — the only place the BYOK key is read and used.
 *
 * Uses a long-lived Port so it can stream progress back to the content script
 * while a long chat is being distilled (otherwise the UI looks frozen). With a
 * key → Tier 2 (full structured brief). Without a key → Tier 0 (deterministic).
 * Nothing leaves the machine except the call to the user's chosen provider.
 */

import {
  distillWithModel,
  distillDeterministic,
  makeLlmClient,
  renderBrief,
} from "@carrybot/core";
import type { DistillRequest, WorkerResponse } from "../shared/messages.js";
import { loadSettings, hasKey } from "../shared/settings.js";

async function runDistill(
  req: DistillRequest,
  post: (msg: WorkerResponse) => void,
): Promise<void> {
  const settings = await loadSettings();
  try {
    if (hasKey(settings)) {
      const client = makeLlmClient({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
      });
      const { brief } = await distillWithModel(req.transcript, client, {
        onProgress: (done, total, phase) =>
          post({ type: "progress", done, total, phase }),
      });
      post({
        type: "brief",
        framings: renderBrief(brief),
        state: brief,
        producedBy: brief.meta.producedBy,
      });
      return;
    }
    // Tier 0 — no key, still a complete, useful handoff.
    const brief = distillDeterministic(req.transcript);
    post({
      type: "brief",
      framings: renderBrief(brief),
      state: brief,
      producedBy: brief.meta.producedBy,
    });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "carrybot") return;
  port.onMessage.addListener((message: unknown) => {
    const req = message as { type?: string };
    if (req?.type === "distill") {
      void runDistill(message as DistillRequest, (msg) => {
        try {
          port.postMessage(msg);
        } catch {
          // Port closed (user navigated/cancelled) — stop quietly.
        }
      });
    }
  });
});
