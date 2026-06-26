/**
 * Content script — runs on claude.ai.
 *
 * 1. Mounts a Shadow-root host + a floating "Carry" button. (Floating, not
 *    docked to Claude's message box, so a Claude UI redesign won't break us —
 *    minimizing DOM coupling is part of the maintenance strategy.)
 * 2. On click: capture the conversation same-origin (session cookie attaches
 *    automatically), hand the transcript to the worker to distill, render the
 *    drawer.
 */

import {
  captureConversation,
  conversationIdFromUrl,
  type FetchLike,
} from "@carrybot/core";
import type {
  DistillResponse,
  ErrorResponse,
  ProgressResponse,
  WorkerResponse,
} from "../shared/messages.js";
import { STYLES } from "./styles.js";
import { openDrawer, type DrawerHandle } from "./drawer.js";

const HOST_ID = "carrybot-host";

// window.fetch is structurally compatible with core's FetchLike.
const fetchImpl: FetchLike = (url, init) =>
  fetch(url, init as RequestInit);

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
): Promise<DistillResponse | ErrorResponse> {
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

async function onCarryClick(shadow: ShadowRoot, button: HTMLButtonElement) {
  const convoId = conversationIdFromUrl(location.href);
  if (!convoId) {
    alert("Open a Claude conversation first, then click Carry.");
    return;
  }

  openHandle?.destroy();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Reading conversation…";

  try {
    const transcript = await captureConversation(convoId, {
      fetchImpl,
      capturedAt: new Date().toISOString(),
    });

    button.textContent = "Distilling…";
    const resp = await distillViaPort(transcript, (p) => {
      button.textContent =
        p.phase === "merging"
          ? "Merging…"
          : `Distilling ${p.done}/${p.total}…`;
    });

    if (resp.type === "error") {
      alert("carrybot: " + resp.message);
      return;
    }
    openHandle = openDrawer(shadow, resp.state, resp.framings);
  } catch (err) {
    alert("carrybot capture failed: " + (err as Error).message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
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

// Claude is a SPA; re-assert the button on navigation without duplicating it.
init();
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    init();
  }
}).observe(document.body, { childList: true, subtree: true });
