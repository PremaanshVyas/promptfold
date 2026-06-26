# carrybot — Product & Build Spec

> One-click context handoff from your AI chat. Carry a long, messy conversation
> into a fresh chat, a different chatbot, or a teammate's hands — losing nothing
> that matters.

Status: **approved design, v1 build in progress** · Date: 2026-06-26

---

## 1. One line

A Chrome extension that lives inside Claude.ai. One click turns the whole
conversation — however long — into a short, structured **brief** (Decided /
Open / Rejected / Verbatim / Files-to-attach) you can paste into a new chat,
another chatbot, or hand to a teammate.

## 2. Problem

Long AI chats die: slow near their limit, unreadable for the next person, and a
fresh chatbot re-suggests dead ideas because it never saw what was ruled out.
Existing tools dump the raw transcript — they move the mess, they don't remove
it. carrybot keeps the *truth* (state + decisions), not the mess.

## 3. Competitive reality (why this is still worth building)

Research found the space is more crowded than the original spec assumed:

- **"Distill instead of dump" is not novel** — thredly, GPTCompress, Continuum,
  AI Context Flow already do it. thredly ships ~75% of the core idea, monetized.
- **"Read the data layer, not the DOM" is table stakes**, not an edge — the
  100k-install incumbents already read the internal API.

The genuinely unoccupied space carrybot wins on:

1. **Strict packaging nobody ships together:** Rejected-**with-why** as a
   *discrete* section, byte-exact **Verbatim**, and a **files-to-attach
   manifest** with a one-line *why* per item.
2. **Portable *decisions*, not raw notes** — the memory players (MemoryPlugin,
   Sider, Mem0) sync facts, never decision provenance.
3. **The eval as proof** — nobody ships the §8 proof harness. For a portfolio,
   "I built it *and* empirically proved it loses nothing" is the differentiator.

## 4. Principles

1. **Read the data, not the screen.** Fetch the conversation from Claude's data
   layer; never scrape rendered bubbles. Artifacts included.
2. **Keep state, not summary.** Where things *stand* (decided/open/rejected),
   not a narrative of what happened.
3. **Capture everything, keep only what matters.** Grab all 200 messages, then
   deliberately produce something smaller. The shrinking is the value.
4. **High fidelity with honest, loud fallback.** Near-perfect, never silent. If
   something can't be parsed or distilled, show it raw and loud.
5. **No artificial limits.** No accounts, no daily caps, no length caps, no
   middleman server. We can't ration what we never see.

## 5. The brief (output)

Every brief has these sections. They are **universal** — they apply equally to a
coding chat, a resume scorer, a marketing plan, or a legal argument. Only the
*contents* of Verbatim change with the subject matter.

- **Decided** — what's locked. Don't relitigate.
- **Open** — live, unresolved threads. Where the next person picks up.
- **Rejected** — what was tried and ruled out, **and why**. The piece nobody
  else carries; it's why fresh chatbots re-suggest dead ideas.
- **Verbatim** — exact, byte-for-byte: names, paths, numbers, API details, the
  precise wording of a constraint, and the **final** version of any code. For a
  non-coding chat there is simply no code here — just the exact names/numbers
  that mattered. Big code becomes an attachment (next section).
- **Bring these for full context** — a checklist of files to attach, each with
  one line saying *why it matters*. Two kinds: (a) big things from the chat
  better as a file than inline; (b) things the chat only *referred to* but never
  contained (e.g. your real `upload_handler.py`).

**Latest state wins.** If a value changed over the chat (timeout 30 → 60), the
brief shows **60**, never both, never the stale 30. ("Show the trail" full
history is a later optional mode.)

### One adaptive mode — no toggle
There is **one** mode. It keeps whatever exact, load-bearing content actually
exists in the chat. No "general vs technical" toggle: a manual toggle is a trap
(pick "general" on a coding chat and you'd silently drop code, breaking the
no-loss promise). The tool adapts to the conversation; the user never chooses.

> **Planned for later — "Simplify for a non-technical reader":** a single
> on-demand button that produces a copy with code/technical detail stripped,
> for when a developer hands a brief to a non-technical teammate. This is an
> *output convenience on top of the one mode*, NOT a second mode. Not in v1;
> added only if real use shows it's needed. Documented here so it isn't lost.

## 6. Tiers (how much you get, by whether you supply a key)

Nobody ever hits a "key or nothing" wall.

- **Tier 0 — no key, works everywhere.** Complete, exact capture (artifacts
  included) + deterministically-extracted Verbatim (code final versions, paths,
  names, numbers, API endpoints) + the files-to-attach checklist. No reasoning,
  but already a more complete export than the popular free tools. Value lands in
  one click, zero setup.
- **Tier 1 — no key, on-device AI (Chrome Summarizer API, Gemini Nano).**
  *Deferred from v1.* GA in Chrome 138 and available to extensions, but the
  model is desktop-only (22 GB disk, strong GPU / 16 GB RAM), has a ~4–6k token
  window, and is too weak for reliable Decided/Open/Rejected structure. Adds a
  free plain-prose summary where the machine supports it — a bonus, not load-
  bearing. Build later behind a capability check.
- **Tier 2 — BYOK.** User's own Anthropic/OpenAI key → the full structured
  brief (real reasoning) + unlimited length via chunk→merge. The user pays their
  provider directly; no limits.

## 7. Capture (the make-or-break)

On click, a content script on `claude.ai` fetches the user's own conversation
from Claude's internal API using the existing logged-in session — the same
request the page itself makes.

Verified endpoint shapes (from two live open-source exporters):

```
GET /api/organizations                                          → list orgs
GET /api/organizations/{org}/chat_conversations/{id}
      ?tree=True&rendering_mode=messages&render_all_tools=true   → full convo
```

- **Same-origin content-script `fetch(url, {credentials:'include'})`** — cookies
  attach automatically, no CSRF token needed today, no CORS, Cloudflare is a
  non-issue (we're inside the already-cleared tab).
- **org_id:** from `/api/organizations`, pick the org whose `capabilities`
  includes `'chat'`, else the first.
- **conversation_id:** from the URL `claude.ai/chat/{id}`.
- **Artifacts** live inside message `content[]` blocks in **three** formats that
  have shifted over time — all three must be handled:
  1. `tool_use` block, `name: 'artifacts'` or `'create_file'`,
     content in `input.display_content` (`code_block` or `json_block` w/ filename).
  2. Legacy `<antArtifact ...>...</antArtifact>` tags in assistant text.
- **Capture-integrity check:** every content block must classify to a known
  type. Anything unknown is surfaced loudly, never dropped (principle 4).

The format is undocumented and shifts — the artifact parser is the one real,
expected maintenance cost. It is isolated so it can be fixed without touching
anything else.

## 8. Distiller

Captured conversation → structured brief, via the user's BYOK model.

- **Chunk → mini-brief → merge** for long chats. The merge step is where
  **latest-state-wins** is enforced (stale 30 replaced by final 60).
- **Keep exact:** final code, names, paths, numbers, API contracts, precise
  constraint wording. **Crush to nothing:** apologies, dead ends,
  re-explanations, "try this / no that failed" loops.
- For each decision, record what it *replaced/ruled out* → keeps Rejected
  accurate.
- **BYOK**, key in `chrome.storage.local`, on the user's machine only. carrybot
  never bills for tokens.

## 9. The eval (the portfolio centerpiece)

Give a fresh model **only the brief**, and separately the **full chat**. Ask
both the same next question. If the brief version makes the same next move, the
brief kept everything load-bearing. Scored across many real chats. Shipped *in
the repo* and rendered by the companion web app. This is the proof no competitor
offers.

## 10. Interface

- **Export chat** button injected near Claude's message box (vanilla TS).
- Click → "reading conversation…" → brief slides in as a **side drawer**.
- Sections from §5; Verbatim clearly marked as an exact block.
- Footer: **Copy brief** (human framing) · **Copy as resume prompt** (bot
  framing) · Share link (later). One engine, two framings.
- A small **"read from data layer"** marker = complete record, not a scrape.
- Injected UI is mounted in a **Shadow DOM** so Claude's CSS and ours never
  collide.

**Not in v1:** sync/save-as-you-go (capture grabs the whole chat fresh each
click, so sync solves a problem we don't have yet).

## 11. Architecture — one monorepo

```
carrybot/                       (pnpm workspaces + Turborepo)
├── packages/core/      framework-agnostic TS brain — fully unit-tested (Vitest)
│     src/capture/      Claude data-layer fetch + artifact parser  ← make-or-break
│     src/distiller/    chunk → mini-brief → merge (latest-state-wins)
│     src/brief/        strict template + the two export framings
│     src/types.ts      shared contracts
├── apps/extension/     MV3 extension (what users install)
│     content/          vanilla TS + Shadow DOM (injected button + drawer)
│     worker/           service worker (BYOK LLM calls; Tier-1 on-device later)
│     options/          React + Tailwind (BYOK key settings)
├── apps/web/           Next.js + Tailwind on Vercel: EVAL RESULTS VIEWER + landing
├── eval/               §9 harness; generates what apps/web displays
└── .github/workflows/  GitHub Actions: lint + Vitest + (Playwright later)
```

**Boundaries (each unit understandable/testable alone):**
- `capture` — input: conversation_id + session → output: normalized transcript +
  artifacts. Knows nothing about LLMs.
- `distiller` — input: normalized transcript → output: brief state. Knows nothing
  about Claude's API shape.
- `brief` — input: brief state → output: two text framings. Knows nothing about
  either.

The senior-level signal is **`packages/core` consumed by BOTH the vanilla
content script and the React app/web** — the split is intentional, not two glued
projects.

## 12. Tech stack & rationale

| Decision | Call | Why |
|---|---|---|
| Language | **TypeScript** everywhere | Portfolio baseline; the parser is exactly where types catch real bugs. |
| Build | **pnpm workspaces + Turborepo**, Vite/WXT for the extension | Modern, AU-employer-standard monorepo. |
| Injected UI | **vanilla TS + Shadow DOM**, no framework | Shadow DOM (not avoiding React) prevents CSS collisions; no per-page-load framework tax in third-party pages. |
| Extension pages / web app | **React + Next.js + Tailwind** | Where a framework belongs; ticks the AU hireability box without touching the injected surface. |
| Distiller | **BYOK Anthropic + OpenAI**, default Anthropic | Capturing Claude chats → Anthropic default is natural; OpenAI proves the adapter abstraction. |
| Tests | **Vitest** on core; Playwright later | Capture parser + merge logic tested against fixtures = provable completeness. |
| CI | **GitHub Actions** | lint + typecheck + tests on PR. The clearest "not junior" signal. |

## 13. Security (public repo — top priority)

- **BYOK key** in `chrome.storage.local` only; never logged, never networked
  except to the user's chosen provider; never in git.
- `.gitignore` blocks `.env*`, keys, raw captures (written *before* `git init`).
- **Secret-scan pre-commit hook** + CI gitleaks-style check.
- **Least-privilege manifest:** `storage`, `activeTab`/`scripting`, host
  permissions for `claude.ai` + the chosen LLM host only. **No `<all_urls>`.**
- **No remote code** (MV3 hard rule): all logic bundled; only data/LLM API calls
  over fetch.
- **Privacy policy** shipped; Data-Safety disclosures completed for the Web
  Store.
- Eval fixtures committed only **sanitized**; raw captures git-ignored.

## 14. Risks (honest)

- **Platform shape changes.** Claude can change its data format; the artifact
  parser will need occasional fixing. The real maintenance cost — isolated by
  design.
- **"Never fails" isn't reachable.** Promise high fidelity + loud fallback.
- **ToS / rate limits.** Reading your own chats with your own LLM key is the
  Export-Data category (low risk), *not* the OpenClaw inference-proxy category
  (banned). We **never** route the Claude session for inference. Fetch on demand,
  one conversation per click, never bulk-loop.

## 15. Scope

**v1 (build now):** Claude only · Tier 0 + Tier 2 · full strict brief incl.
files-to-attach · Copy brief + Copy as resume prompt · BYOK options · the eval ·
companion web viewer · CI · security hardening · privacy policy.

**Later:** Tier 1 on-device · "Simplify for non-technical reader" button ·
ChatGPT/Gemini adapters · sync · share links · "show the trail" · teammate
comments.

## 16. Build order (don't skip — #2 is make-or-break)

1. Button shows up inside Claude.
2. **Capture a complete chat into clean data (artifacts included).** ← foundation
3. Short chat → correct brief.
4. Long chats: chunk + merge, latest-value-wins.
5. Drawer UI + copy buttons.
6. Eval; tune the instruction set until briefs consistently win.
7. Web viewer, privacy, polish, publish.
