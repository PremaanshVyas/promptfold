/**
 * Content script, runs on claude.ai.
 *
 * 1. Mounts a Shadow-root host + a floating "Carry" button.
 * 2. On click: if this chat already has a saved brief, show it instantly (with a
 *    Regenerate option). Otherwise capture same-origin, distill via the worker,
 *    cache the result, and show it. No key → a clear CTA + free clean transcript.
 */

import {
  captureConversation,
  conversationIdFromUrl,
  renderTranscriptText,
  type FetchLike,
  type NormalizedTranscript,
} from "@carrybot/core";
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

const HOST_ID = "carrybot-host";

const fetchImpl: FetchLike = (url, init) => fetch(url, init as RequestInit);

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

/** Send the transcript to the worker over a port and stream progress back. */
function distillViaPort(
  transcript: unknown,
  onProgress: (p: ProgressResponse) => void,
): Promise<DistillResponse | NeedsKeyResponse | ErrorResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const port = chrome.runtime.connect({ name: "carrybot" });
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

/** Capture + distill + cache + render. */
async function generate(
  shadow: ShadowRoot,
  button: HTMLButtonElement,
  convoId: string,
) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Reading conversation…";

  let transcript: NormalizedTranscript;
  try {
    transcript = await captureConversation(convoId, {
      fetchImpl,
      capturedAt: new Date().toISOString(),
    });
  } catch (err) {
    alert("carrybot capture failed: " + (err as Error).message);
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
    alert("carrybot: " + resp.message);
    return;
  }

  const savedAt = new Date().toISOString();
  await saveCachedBrief(convoId, {
    state: resp.state,
    framings: resp.framings,
    producedBy: resp.producedBy,
    savedAt,
  });
  openHandle = openBriefDrawer(shadow, {
    state: resp.state,
    framings: resp.framings,
    savedAt,
    onRegenerate: () => void generate(shadow, button, convoId),
  });
}

async function onCarryClick(shadow: ShadowRoot, button: HTMLButtonElement) {
  const convoId = conversationIdFromUrl(location.href);
  if (!convoId) {
    alert("Open a Claude conversation first, then click Carry.");
    return;
  }
  openHandle?.destroy();

  // Show the saved brief instantly if we have one; let the user Regenerate.
  const cached = await loadCachedBrief(convoId);
  if (cached) {
    openHandle = openBriefDrawer(shadow, {
      state: cached.state,
      framings: cached.framings,
      savedAt: cached.savedAt,
      onRegenerate: () => void generate(shadow, button, convoId),
    });
    return;
  }
  await generate(shadow, button, convoId);
}

function injectButton(shadow: ShadowRoot) {
  if (shadow.querySelector(".cb-fab")) return;
  const button = document.createElement("button");
  button.className = "cb-fab";
  button.textContent = "Carry ↗";
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
