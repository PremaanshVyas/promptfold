/**
 * Service worker, the only place the BYOK key is read and used.
 *
 * Uses a long-lived Port so it can stream progress back to the content script
 * while a long chat is being distilled (otherwise the UI looks frozen). With a
 * key → Tier 2 (full structured brief). Without a key → Tier 0 (deterministic).
 * Nothing leaves the machine except the call to the user's chosen provider.
 */

import { distillWithModel, makeLlmClient, renderBrief } from "@promptfold/core";
import type { DistillRequest, WorkerResponse } from "../shared/messages.js";
import { loadSettings, hasKey } from "../shared/settings.js";

/**
 * Keep the MV3 service worker alive during a long distill. Chrome reaps an idle
 * worker after ~30s; a single long LLM call (the merge) has no events to reset
 * that timer, which killed the worker mid-merge. Pinging any extension API every
 * 20s resets the idle timer. Returns a stop function.
 */
function startKeepAlive(): () => void {
  const id = setInterval(() => {
    // The callback form is a no-op API call purely to reset the idle timer.
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, 20_000);
  return () => clearInterval(id);
}

async function runDistill(
  req: DistillRequest,
  post: (msg: WorkerResponse) => void,
): Promise<void> {
  const settings = await loadSettings();
  if (!hasKey(settings)) {
    // No key → the brief needs a model. Tell the content script, which offers a
    // clean raw export instead of a hollow, reasoning-free "brief".
    post({ type: "needsKey" });
    return;
  }
  const stopKeepAlive = startKeepAlive();
  try {
    const client = makeLlmClient({
      provider: settings.provider,
      apiKey: settings.apiKey,
      model: settings.model,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
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
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  } finally {
    stopKeepAlive();
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "promptfold") return;
  port.onMessage.addListener((message: unknown) => {
    const req = message as { type?: string };
    if (req?.type === "distill") {
      void runDistill(message as DistillRequest, (msg) => {
        try {
          port.postMessage(msg);
        } catch {
          // Port closed (user navigated/cancelled), stop quietly.
        }
      });
    }
  });
});

// One-off messages from the content script (e.g. "open the options page", which
// a content script cannot do itself).
chrome.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: string })?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});
