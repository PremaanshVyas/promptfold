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

function buildBody(state: BriefState): HTMLElement {
  const body = el("div", "cb-body");

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

  // Decided
  body.appendChild(
    listSection(
      "Decided",
      "decided",
      state.decided.map((d) => {
        const li = el("li", undefined, d.text);
        if (d.replaces) li.appendChild(el("span", "cb-why", `  (replaced: ${d.replaces})`));
        return li;
      }),
      "No locked decisions found (try a key for the full structured brief).",
    ),
  );

  // Open
  body.appendChild(
    listSection(
      "Open",
      "open",
      state.open.map((o) => el("li", undefined, o.text)),
      "No open threads identified.",
    ),
  );

  // Rejected (the differentiator)
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

  // Verbatim
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

  // Files to attach
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

  // Raw appendix for unknown blocks (never dropped).
  if (state.meta.integrity.unknown.length > 0) {
    const raw = el("div", "cb-section");
    raw.appendChild(el("h3", undefined, "Raw — could not parse (review these)"));
    for (const u of state.meta.integrity.unknown) {
      raw.appendChild(el("div", "cb-tag", `${u.hint} · message ${u.messageUuid.slice(0, 8)}`));
      raw.appendChild(el("pre", "cb-code", u.preview));
    }
    body.appendChild(raw);
  }

  return body;
}

export interface DrawerHandle {
  destroy: () => void;
}

export function openDrawer(
  shadow: ShadowRoot,
  state: BriefState,
  framings: BriefFramings,
): DrawerHandle {
  const overlay = el("div", "cb-overlay");
  const drawer = el("div", "cb-drawer");

  // Header
  const head = el("div", "cb-head");
  const titleWrap = el("div");
  titleWrap.appendChild(el("div", "cb-title", "Handoff brief"));
  titleWrap.appendChild(el("div", "cb-sub", state.meta.title));
  titleWrap.appendChild(
    el("div", "cb-marker", `read from data layer · ${state.meta.producedBy}`),
  );
  const close = el("button", "cb-close", "×");
  head.appendChild(titleWrap);
  head.appendChild(close);

  // Footer with copy actions
  const foot = el("div", "cb-foot");
  const copyBrief = el("button", "cb-btn primary", "Copy brief");
  const copyResume = el("button", "cb-btn", "Copy as resume prompt");
  const toast = el("div", "cb-toast", "Copied ✓");
  foot.appendChild(copyBrief);
  foot.appendChild(copyResume);
  foot.appendChild(toast);

  function flashToast() {
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1400);
  }
  copyBrief.addEventListener("click", async () => {
    await navigator.clipboard.writeText(framings.humanMarkdown);
    flashToast();
  });
  copyResume.addEventListener("click", async () => {
    await navigator.clipboard.writeText(framings.resumePrompt);
    flashToast();
  });

  drawer.appendChild(head);
  drawer.appendChild(buildBody(state));
  drawer.appendChild(foot);
  overlay.appendChild(drawer);

  function destroy() {
    overlay.remove();
  }
  close.addEventListener("click", destroy);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) destroy();
  });

  // Ensure styles exist in this shadow root once.
  if (!shadow.querySelector("style[data-cb]")) {
    const style = el("style");
    style.setAttribute("data-cb", "");
    style.textContent = STYLES;
    shadow.appendChild(style);
  }
  shadow.appendChild(overlay);
  return { destroy };
}
