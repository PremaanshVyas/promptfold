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
import type { WorkerResponse } from "../shared/messages.js";
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
    const resp = (await chrome.runtime.sendMessage({
      type: "distill",
      transcript,
    })) as WorkerResponse;

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
