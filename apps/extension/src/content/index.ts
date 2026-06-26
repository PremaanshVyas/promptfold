/**
 * Content script. Runs on every supported chat site (see manifest matches).
 *
 * 1. Mounts a Shadow-root host + a floating "Carry" button.
 * 2. On click: show the saved brief instantly if we have one (with Regenerate),
 *    else capture via the right adapter for this site, distill via the worker,
 *    cache, and show it. No key -> a clear CTA + free clean transcript.
 *
 * The site-specific part lives entirely in ./capture (the adapter registry), so
 * this file is platform-agnostic.
 */

import { renderTranscriptText, type NormalizedTranscript } from "@promptfold/core";
import type {
  DistillResponse,
  ErrorResponse,
  NeedsKeyResponse,
  ProgressResponse,
  WorkerResponse,
} from "../shared/messages.js";
import { STYLES } from "./styles.js";
import {
  openBriefDrawer,
  openNeedsKeyDrawer,
  type DrawerHandle,
} from "./drawer.js";
import { loadCachedBrief, saveCachedBrief } from "../shared/cache.js";
import { pickAdapter, type CaptureSource } from "./capture.js";

const HOST_ID = "promptfold-host";

/** Stable per-conversation key for the cache, works on any site. */
function cacheKey(): string {
  return location.host + location.pathname;
}

function mountHost(): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (host?.shadowRoot) return host.shadowRoot;
  host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.setAttribute("data-cb", "");
  style.textContent = STYLES;
  shadow.appendChild(style);
  return shadow;
}

let openHandle: DrawerHandle | null = null;

function distillViaPort(
  transcript: unknown,
  onProgress: (p: ProgressResponse) => void,
): Promise<DistillResponse | NeedsKeyResponse | ErrorResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const port = chrome.runtime.connect({ name: "promptfold" });
    port.onMessage.addListener((msg: WorkerResponse) => {
      if (msg.type === "progress") {
        onProgress(msg);
        return;
      }
      settled = true;
      resolve(msg);
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      if (!settled) {
        settled = true;
        resolve({ type: "error", message: "Background worker disconnected." });
      }
    });
    port.postMessage({ type: "distill", transcript });
  });
}

function openSettings() {
  window.open(chrome.runtime.getURL("options.html"), "_blank");
}

async function generate(shadow: ShadowRoot, button: HTMLButtonElement) {
  const adapter = pickAdapter(location.hostname);
  const source: CaptureSource = adapter.source;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Reading conversation…";

  let transcript: NormalizedTranscript;
  try {
    transcript = await adapter.capture(new Date().toISOString());
  } catch (err) {
    alert("PromptFold: " + (err as Error).message);
    button.disabled = false;
    button.textContent = original;
    return;
  }

  button.textContent = "Distilling…";
  const resp = await distillViaPort(transcript, (p) => {
    button.textContent =
      p.phase === "merging" ? "Merging…" : `Distilling ${p.done}/${p.total}…`;
  });
  button.disabled = false;
  button.textContent = original;

  if (resp.type === "needsKey") {
    openHandle = openNeedsKeyDrawer(shadow, {
      onOpenSettings: openSettings,
      onCopyTranscript: async () => {
        await navigator.clipboard.writeText(renderTranscriptText(transcript));
      },
    });
    return;
  }
  if (resp.type === "error") {
    alert("PromptFold: " + resp.message);
    return;
  }

  const savedAt = new Date().toISOString();
  await saveCachedBrief(cacheKey(), {
    state: resp.state,
    framings: resp.framings,
    producedBy: resp.producedBy,
    source,
    savedAt,
  });
  openHandle = openBriefDrawer(shadow, {
    state: resp.state,
    framings: resp.framings,
    source,
    savedAt,
    onRegenerate: () => void generate(shadow, button),
  });
}

async function onCarryClick(shadow: ShadowRoot, button: HTMLButtonElement) {
  openHandle?.destroy();

  // Show the saved brief instantly if we have one; let the user Regenerate.
  const cached = await loadCachedBrief(cacheKey());
  if (cached) {
    openHandle = openBriefDrawer(shadow, {
      state: cached.state,
      framings: cached.framings,
      source: cached.source,
      savedAt: cached.savedAt,
      onRegenerate: () => void generate(shadow, button),
    });
    return;
  }
  await generate(shadow, button);
}

function injectButton(shadow: ShadowRoot) {
  if (shadow.querySelector(".cb-fab")) return;
  const button = document.createElement("button");
  button.className = "cb-fab";
  button.textContent = "Fold ↗";
  button.title = "Turn this chat into a handoff brief";
  button.addEventListener("click", () => void onCarryClick(shadow, button));
  shadow.appendChild(button);
}

function init() {
  const shadow = mountHost();
  injectButton(shadow);
}

init();
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    init();
  }
}).observe(document.body, { childList: true, subtree: true });
