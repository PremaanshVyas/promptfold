/**
 * Renders the brief drawer inside a Shadow root.
 *
 * Security: chat content is untrusted. We build the DOM with createElement +
 * textContent ONLY — never innerHTML — so nothing in a conversation can inject
 * markup or script into the page.
 */

import type { BriefState, BriefFramings } from "@carrybot/core";
import { STYLES } from "./styles.js";

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

/** A muted, dashed box showing text that gets inserted around the brief. */
function framePreview(label: string, text: string): HTMLElement {
  const box = el("div", "cb-frame");
  box.appendChild(el("span", "cb-frame-label", label));
  box.appendChild(el("span", undefined, text));
  return box;
}

function buildBody(state: BriefState, framings: BriefFramings): HTMLElement {
  const body = el("div", "cb-body");

  // Show the resume-prompt INTRO that will be inserted when you Copy.
  body.appendChild(
    framePreview("inserted at the top when you copy", framings.resumeHeader),
  );

  // Loud honesty banners.
  if (!state.meta.integrity.complete) {
    body.appendChild(
      el(
        "div",
        "cb-warn",
        `⚠️ Capture not 100% clean — ${state.meta.integrity.unknown.length} block(s) couldn't be parsed and are shown raw below. Nothing was dropped silently.`,
      ),
    );
  }
  for (const fb of state.meta.rawFallbacks) {
    body.appendChild(el("div", "cb-warn", `⚠️ ${fb}`));
  }

  body.appendChild(
    listSection(
      "Decided",
      "decided",
      state.decided.map((d) => {
        const li = el("li", undefined, d.text);
        if (d.replaces) li.appendChild(el("span", "cb-why", `  (replaced: ${d.replaces})`));
        return li;
      }),
      "No locked decisions found.",
    ),
  );

  body.appendChild(
    listSection(
      "Open",
      "open",
      state.open.map((o) => el("li", undefined, o.text)),
      "No open threads identified.",
    ),
  );

  body.appendChild(
    listSection(
      "Rejected (and why)",
      "rejected",
      state.rejected.map((r) => {
        const li = el("li");
        li.appendChild(el("strong", undefined, r.idea));
        li.appendChild(el("span", "cb-why", ` — ${r.why}`));
        return li;
      }),
      "Nothing ruled out yet.",
    ),
  );

  const verb = el("div", "cb-section");
  verb.appendChild(el("h3", undefined, "Verbatim — keep exact"));
  if (state.verbatim.length === 0) {
    verb.appendChild(el("div", "cb-empty", "No exact values extracted."));
  } else {
    for (const v of state.verbatim) {
      if (v.kind === "code") {
        verb.appendChild(el("div", "cb-tag", v.label + (v.language ? ` · ${v.language}` : "")));
        verb.appendChild(el("pre", "cb-code", v.value));
      } else {
        const p = el("div", "cb-file");
        p.appendChild(el("span", "cb-tag", `${v.label} (${v.kind}): `));
        p.appendChild(el("code", undefined, v.value));
        verb.appendChild(p);
      }
    }
  }
  body.appendChild(verb);

  body.appendChild(
    listSection(
      "Bring these for full context",
      "",
      state.filesToAttach.map((f) => {
        const li = el("li", "cb-file");
        li.appendChild(el("code", undefined, f.name));
        li.appendChild(el("span", "cb-why", ` — ${f.why} (${f.source})`));
        return li;
      }),
      "No external files needed.",
    ),
  );

  if (state.meta.integrity.unknown.length > 0) {
    const raw = el("div", "cb-section");
    raw.appendChild(el("h3", undefined, "Raw — could not parse (review these)"));
    for (const u of state.meta.integrity.unknown) {
      raw.appendChild(el("div", "cb-tag", `${u.hint} · message ${u.messageUuid.slice(0, 8)}`));
      raw.appendChild(el("pre", "cb-code", u.preview));
    }
    body.appendChild(raw);
  }

  // Show the resume-prompt OUTRO that will be inserted when you Copy.
  body.appendChild(
    framePreview("added at the end when you copy", framings.resumeFooter),
  );

  return body;
}

export interface DrawerHandle {
  destroy: () => void;
}

/** Shared drawer shell (overlay + sliding panel + header). */
function shell(
  shadow: ShadowRoot,
  subtitle: string,
  marker: string,
): {
  overlay: HTMLElement;
  drawer: HTMLElement;
  destroy: () => void;
} {
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
  return { overlay, drawer, destroy };
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export interface BriefDrawerOptions {
  state: BriefState;
  framings: BriefFramings;
  savedAt: string;
  /** Re-run capture + distill and replace this drawer. */
  onRegenerate: () => void;
}

/** Open the full brief drawer. */
export function openBriefDrawer(
  shadow: ShadowRoot,
  opts: BriefDrawerOptions,
): DrawerHandle {
  const { state, framings, savedAt, onRegenerate } = opts;
  const { drawer, destroy } = shell(
    shadow,
    state.meta.title,
    `read from data layer · ${state.meta.producedBy} · generated ${relativeTime(savedAt)}`,
  );

  drawer.appendChild(buildBody(state, framings));

  const foot = el("div", "cb-foot");
  const copy = el("button", "cb-btn primary", "Copy (resume prompt)");
  const regen = el("button", "cb-btn", "Regenerate");
  const toast = el("div", "cb-toast", "Copied ✓");
  foot.appendChild(copy);
  foot.appendChild(regen);
  foot.appendChild(toast);

  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(framings.resumePrompt);
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1400);
  });
  regen.addEventListener("click", () => {
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

/** Open the no-key panel: a clear CTA + a free clean-transcript export. */
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
        "settings — it stays on your machine and is sent only to your chosen " +
        "provider. Meanwhile you can still copy a clean, complete transcript of " +
        "this conversation.",
    ),
  );
  drawer.appendChild(panel);

  const foot = el("div", "cb-foot");
  const settingsBtn = el("button", "cb-btn primary", "Open settings");
  const copyBtn = el("button", "cb-btn", "Copy clean transcript");
  const toast = el("div", "cb-toast", "Copied ✓");
  foot.appendChild(settingsBtn);
  foot.appendChild(copyBtn);
  foot.appendChild(toast);

  settingsBtn.addEventListener("click", () => opts.onOpenSettings());
  copyBtn.addEventListener("click", async () => {
    await opts.onCopyTranscript();
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1400);
  });

  drawer.appendChild(foot);
  return { destroy };
}
