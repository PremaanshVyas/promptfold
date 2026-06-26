/**
 * Brief renderer — BriefState → two text framings.
 *
 * One engine, two outputs:
 *   - humanMarkdown: for a teammate to read.
 *   - resumePrompt:  "here's where we were, continue from here" for any chatbot.
 *
 * Honesty is rendered, not hidden: if capture was incomplete or the distiller
 * fell back, the brief says so loudly at the top.
 */

import type { BriefState, BriefFramings, VerbatimItem } from "../types.js";

function section(title: string, body: string): string {
  return body.trim().length > 0 ? `## ${title}\n\n${body.trim()}\n` : "";
}

function renderVerbatimItem(v: VerbatimItem): string {
  if (v.kind === "code") {
    const lang = v.language ?? "";
    return `**${v.label}**\n\n\`\`\`${lang}\n${v.value}\n\`\`\``;
  }
  return `- **${v.label}** (${v.kind}): \`${v.value}\``;
}

/** A loud banner when something is not 100% — never silent. */
function honestyBanner(state: BriefState): string {
  const lines: string[] = [];
  const integrity = state.meta.integrity;
  if (!integrity.complete) {
    lines.push(
      `> ⚠️ **Capture not 100% clean.** ${integrity.unknown.length} block(s) ` +
        `could not be parsed and are listed raw below — review them; nothing was dropped silently.`,
    );
  }
  if (state.meta.rawFallbacks.length > 0) {
    lines.push(
      `> ⚠️ **Distiller fell back** in places: ${state.meta.rawFallbacks.join(" ")}`,
    );
  }
  return lines.join("\n");
}

function unknownBlocksAppendix(state: BriefState): string {
  const unknown = state.meta.integrity.unknown;
  if (unknown.length === 0) return "";
  const items = unknown
    .map(
      (u) => `- \`${u.hint}\` (message ${u.messageUuid.slice(0, 8)}): ${u.preview}`,
    )
    .join("\n");
  return section("Raw — could not parse (review these)", items);
}

function renderBody(state: BriefState): string {
  const decided = state.decided
    .map((d) => `- ${d.text}${d.replaces ? ` _(replaced: ${d.replaces})_` : ""}`)
    .join("\n");

  const open = state.open.map((o) => `- ${o.text}`).join("\n");

  const rejected = state.rejected
    .map((r) => `- **${r.idea}** — ${r.why}`)
    .join("\n");

  const verbatim = state.verbatim.map(renderVerbatimItem).join("\n\n");

  const files = state.filesToAttach
    .map((f) => `- \`${f.name}\` — ${f.why} _(${f.source})_`)
    .join("\n");

  return [
    section("Decided", decided),
    section("Open", open),
    section("Rejected (and why)", rejected),
    section("Verbatim — keep exact", verbatim),
    section("Bring these for full context", files),
    unknownBlocksAppendix(state),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Render a BriefState into both framings. */
export function renderBrief(state: BriefState): BriefFramings {
  const banner = honestyBanner(state);
  const body = renderBody(state);

  const header =
    `# Handoff brief — ${state.meta.title}\n\n` +
    `_Produced by ${state.meta.producedBy} · read from Claude's data layer (complete record, not a screen scrape)._\n`;

  const humanMarkdown = [header, banner, body]
    .filter((s) => s.trim().length > 0)
    .join("\n");

  const resumePrompt = [
    "Here's where we were on this project. Continue from this exact state — " +
      "do not re-suggest anything under \"Rejected\", and treat everything under " +
      '"Verbatim" as fixed and exact.',
    "",
    banner.trim().length > 0 ? banner : "",
    body,
    "",
    "Pick up from the Open items above. What's the next step?",
  ]
    .filter((s) => s.length > 0)
    .join("\n");

  return { humanMarkdown, resumePrompt };
}
