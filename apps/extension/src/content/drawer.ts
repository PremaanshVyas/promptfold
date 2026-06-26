/**
 * Renders the brief drawer inside a Shadow root.
 *
 * Security: chat content is untrusted. We build the DOM with createElement +
 * textContent ONLY, never innerHTML, so nothing in a conversation can inject
 * markup or script into the page.
 */

import type { BriefState, BriefFramings } from "@carrybot/core";
import { STYLES } from "./styles.js";
import {
  exportMarkdown,
  exportText,
  openPrintView,
} from "./export.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function listSection(
  title: string,
  cls: string,
  items: HTMLElement[],
  emptyNote: string,
): HTMLElement {
  const section = el("div", `cb-section ${cls}`);
  section.appendChild(el("h3", undefined, title));
  if (items.length === 0) {
    section.appendChild(el("div", "cb-empty", emptyNote));
  } else {
    const ul = el("ul", "cb-list");
    for (const it of items) ul.appendChild(it);
    section.appendChild(ul);
  }
  return section;
}

function framePreview(label: string, text: string): HTMLElement {
  const box = el("div", "cb-frame");
  box.appendChild(el("span", "cb-frame-label", label));
  box.appendChild(el("span", undefined, text));
  return box;
}

/** The brief sections (no framing boxes, those are added separately). */
function buildSections(state: BriefState): HTMLElement[] {
  const out: HTMLElement[] = [];

  if (state.now.trim().length > 0) {
    const now = el("div", "cb-section");
    now.appendChild(el("h3", undefined, "Now"));
    now.appendChild(el("div", "cb-now", state.now.trim()));
    out.push(now);
  }

  if (!state.meta.integrity.complete) {
    out.push(
      el(
        "div",
        "cb-warn",
        `⚠️ Capture not 100% clean, ${state.meta.integrity.unknown.length} block(s) couldn't be parsed and are shown raw below. Nothing was dropped silently.`,
      ),
    );
  }
  for (const fb of state.meta.rawFallbacks) {
    out.push(el("div", "cb-warn", `⚠️ ${fb}`));
  }

  out.push(
    listSection(
      "Decided",
      "decided",
      state.decided.map((d) => {
        const li = el("li", undefined, d.text);
        if (d.replaces) li.appendChild(el("span", "cb-why", ` (replaced: ${d.replaces})`));
        return li;
      }),
      "No locked decisions found.",
    ),
  );

  out.push(
    listSection(
      "Open",
      "open",
      state.open.map((o) => el("li", undefined, o.text)),
      "No open threads identified.",
    ),
  );

  out.push(
    listSection(
      "Rejected (and why)",
      "rejected",
      state.rejected.map((r) => {
        const li = el("li");
        li.appendChild(el("span", "cb-rej-idea", r.idea));
        li.appendChild(el("span", "cb-why", `, ${r.why}`));
        return li;
      }),
      "Nothing ruled out yet.",
    ),
  );

  const verb = el("div", "cb-section");
  verb.appendChild(el("h3", undefined, "Verbatim, keep exact"));
  if (state.verbatim.length === 0) {
    verb.appendChild(el("div", "cb-empty", "No exact values extracted."));
  } else {
    for (const v of state.verbatim) {
      const item = el("div", "cb-vitem");
      item.appendChild(
        el("div", "cb-vlabel", `${v.label} · ${v.kind}${v.language ? " · " + v.language : ""}`),
      );
      if (v.kind === "code") {
        item.appendChild(el("pre", "cb-code", v.value));
      } else {
        item.appendChild(el("div", "cb-vvalue", v.value));
      }
      verb.appendChild(item);
    }
  }
  out.push(verb);

  out.push(
    listSection(
      "Bring these for full context",
      "",
      state.filesToAttach.map((f) => {
        const li = el("li", "cb-file");
        li.appendChild(el("code", undefined, f.name));
        li.appendChild(el("span", "cb-why", `, ${f.why} (${f.source})`));
        return li;
      }),
      "No external files needed.",
    ),
  );

  if (state.meta.integrity.unknown.length > 0) {
    const raw = el("div", "cb-section");
    raw.appendChild(el("h3", undefined, "Raw, could not parse (review these)"));
    for (const u of state.meta.integrity.unknown) {
      raw.appendChild(el("div", "cb-vlabel", `${u.hint} · message ${u.messageUuid.slice(0, 8)}`));
      raw.appendChild(el("pre", "cb-code", u.preview));
    }
    out.push(raw);
  }

  return out;
}

export interface DrawerHandle {
  destroy: () => void;
}

function shell(
  shadow: ShadowRoot,
  subtitle: string,
  marker: string,
): { drawer: HTMLElement; destroy: () => void } {
  const overlay = el("div", "cb-overlay");
  const drawer = el("div", "cb-drawer");

  const head = el("div", "cb-head");
  const titleWrap = el("div");
  titleWrap.appendChild(el("div", "cb-title", "Handoff brief"));
  titleWrap.appendChild(el("div", "cb-sub", subtitle));
  if (marker) titleWrap.appendChild(el("div", "cb-marker", marker));
  const close = el("button", "cb-close", "×");
  head.appendChild(titleWrap);
  head.appendChild(close);
  drawer.appendChild(head);

  overlay.appendChild(drawer);
  function destroy() {
    overlay.remove();
  }
  close.addEventListener("click", destroy);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) destroy();
  });

  if (!shadow.querySelector("style[data-cb]")) {
    const style = el("style");
    style.setAttribute("data-cb", "");
    style.textContent = STYLES;
    shadow.appendChild(style);
  }
  shadow.appendChild(overlay);
  return { drawer, destroy };
}

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export interface BriefDrawerOptions {
  state: BriefState;
  framings: BriefFramings;
  /** "data layer" (complete) or "screen" (DOM fallback, lower fidelity). */
  source: string;
  savedAt: string;
  onRegenerate: () => void;
}

export function openBriefDrawer(
  shadow: ShadowRoot,
  opts: BriefDrawerOptions,
): DrawerHandle {
  const { state, framings, source, savedAt, onRegenerate } = opts;
  const title = state.meta.title;
  const { drawer, destroy } = shell(
    shadow,
    title,
    `read from ${source} · ${state.meta.producedBy} · generated ${relativeTime(savedAt)}`,
  );

  // Body: framing preview (top) → sections → framing preview (bottom).
  const body = el("div", "cb-body");
  if (source === "screen") {
    body.appendChild(
      el(
        "div",
        "cb-warn",
        "Captured from the screen, not this platform's data layer. " +
          "Side-panel content (artifacts, canvases) may be missing. Supported " +
          "platforms get a complete capture.",
      ),
    );
  }
  const headFrame = framePreview("added at the TOP when you copy / export", framings.resumeHeader);
  const footFrame = framePreview("added at the END when you copy / export", framings.resumeFooter);
  body.appendChild(headFrame);
  for (const s of buildSections(state)) body.appendChild(s);
  body.appendChild(footFrame);
  drawer.appendChild(body);

  // Footer: framing toggle + actions.
  let includeFraming = true;
  const chosenText = () => (includeFraming ? framings.resumePrompt : framings.humanMarkdown);

  const foot = el("div", "cb-foot");

  const toolbar = el("div", "cb-toolbar");
  const toggleLabel = el("label", "cb-toggle");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  toggleLabel.appendChild(checkbox);
  toggleLabel.appendChild(el("span", undefined, "Include resume framing (the intro/outro above)"));
  toolbar.appendChild(toggleLabel);
  foot.appendChild(toolbar);

  const actions = el("div", "cb-actions");
  const copyBtn = el("button", "cb-btn primary", "Copy");
  const mdBtn = el("button", "cb-btn", "Markdown");
  const txtBtn = el("button", "cb-btn ghost", "Text");
  const pdfBtn = el("button", "cb-btn ghost", "PDF");
  const regenBtn = el("button", "cb-btn ghost", "Regenerate");
  const toast = el("div", "cb-toast", "Copied ✓");
  actions.append(copyBtn, mdBtn, txtBtn, pdfBtn, regenBtn, toast);
  foot.appendChild(actions);

  checkbox.addEventListener("change", () => {
    includeFraming = checkbox.checked;
    headFrame.style.display = includeFraming ? "" : "none";
    footFrame.style.display = includeFraming ? "" : "none";
  });

  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(chosenText());
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1400);
  });
  mdBtn.addEventListener("click", () => exportMarkdown(title, chosenText()));
  txtBtn.addEventListener("click", () => exportText(title, chosenText()));
  pdfBtn.addEventListener("click", () => openPrintView(title, chosenText()));
  regenBtn.addEventListener("click", () => {
    destroy();
    onRegenerate();
  });

  drawer.appendChild(foot);
  return { destroy };
}

export interface NeedsKeyOptions {
  onOpenSettings: () => void;
  onCopyTranscript: () => Promise<void>;
}

export function openNeedsKeyDrawer(
  shadow: ShadowRoot,
  opts: NeedsKeyOptions,
): DrawerHandle {
  const { drawer, destroy } = shell(shadow, "API key required", "");

  const panel = el("div", "cb-needkey");
  panel.appendChild(el("h2", undefined, "Add your API key to generate a brief"));
  panel.appendChild(
    el(
      "p",
      undefined,
      "carrybot distills the chat with your own AI model (BYOK). Add a key in " +
        "settings, it stays on your machine and is sent only to your chosen " +
        "provider. Meanwhile you can still copy a clean, complete transcript of " +
        "this conversation.",
    ),
  );
  drawer.appendChild(panel);

  const foot = el("div", "cb-foot");
  const actions = el("div", "cb-actions");
  const settingsBtn = el("button", "cb-btn primary", "Open settings");
  const copyBtn = el("button", "cb-btn", "Copy clean transcript");
  const toast = el("div", "cb-toast", "Copied ✓");
  actions.append(settingsBtn, copyBtn, toast);
  foot.appendChild(actions);

  settingsBtn.addEventListener("click", () => opts.onOpenSettings());
  copyBtn.addEventListener("click", async () => {
    await opts.onCopyTranscript();
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1400);
  });

  drawer.appendChild(foot);
  return { destroy };
}
