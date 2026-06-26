# carrybot

**One-click context handoff from your AI chat.** carrybot lives inside Claude.ai.
One click turns a long, messy conversation into a short, structured **brief** —
*Decided / Open / Rejected / Verbatim / Files-to-attach* — that you can paste
into a fresh chat, a different chatbot, or hand to a teammate, **without losing
anything that matters**.

> Carry the context to your next chat **or** your teammate.

---

## Why this exists

Long AI chats die. They get slow near their limit, the next person can't read
200 messages to catch up, and a fresh chatbot keeps re-suggesting ideas you
already ruled out. Most tools "solve" this by dumping the raw transcript — which
just moves the mess. carrybot keeps the **state and the decisions**, not the mess.

The shrinking *is* the value: it captures all 200 messages, then deliberately
produces something smaller.

## What makes it different

The chat-export space is crowded, so carrybot is sharp about where it wins
([full competitive analysis in the design doc](docs/superpowers/specs/2026-06-26-carrybot-design.md)):

- **Rejected — and why — as its own section.** The piece nobody else carries.
  It's why fresh chatbots re-suggest dead ideas; carrybot stops that.
- **Files-to-attach manifest**, each with one line on *why it matters* —
  including files the chat only *referred to* but never contained.
- **Latest state wins.** If a value changed over the chat (timeout 30 → 60), the
  brief shows 60, never the stale 30.
- **Read from the data layer, not the screen.** It fetches the conversation from
  Claude's API (artifacts included), so it never misses side-panel content the
  way DOM-scrapers do.
- **Proof, not promises.** A [shipped eval](#the-eval-the-proof) measures whether
  a brief preserves everything load-bearing. No competitor ships this.

## Tiers — nobody hits a "key or nothing" wall

| Tier | Needs | What you get |
|---|---|---|
| **0** | nothing | Complete, exact capture + extracted verbatim (code, paths, numbers, APIs) + files-to-attach. Works everywhere, instantly. |
| **2** | your own API key (BYOK) | The full structured brief with real reasoning, unlimited length via chunk→merge. |

*(Tier 1, a free on-device summary via Chrome's built-in AI, is
[planned for later](docs/superpowers/specs/2026-06-26-carrybot-design.md#6-tiers)
— the model is too weak and too rarely available to be load-bearing today.)*

**No accounts. No daily limits. No length caps. No middleman server.** Your chat
is read locally and sent only to the provider *you* chose with *your* key. We
can't ration what we never see.

## Architecture

A pnpm + Turborepo monorepo. The senior-level signal is `packages/core` —
framework-agnostic logic consumed by **both** the vanilla content script and the
React web app.

```
carrybot/
├── packages/core/      framework-agnostic brain — capture · distiller · brief (Vitest)
├── apps/extension/     MV3 extension — vanilla TS + Shadow DOM injected UI, React options
├── apps/web/           Next.js + Tailwind — live eval-results viewer + landing
├── eval/               the proof harness (brief vs full chat)
└── docs/               design spec, privacy, security
```

Three boundaries, each testable in isolation:
**capture** (Claude data → normalized transcript) → **distiller** (transcript →
brief state) → **brief** (state → two text framings). The injected UI is mounted
in a **Shadow DOM**, so Claude's CSS and carrybot's never collide.

## The eval (the proof)

Give a fresh model **only the brief**, and separately the **full chat**. Ask both
the same next question. If the brief-only answer makes the same next move, the
brief kept everything that mattered.

```bash
pnpm eval                      # shape + size report (no key needed)
CARRYBOT_API_KEY=… pnpm eval   # full same-next-move judgement
```

Results are written to [`eval/scorecard.md`](eval/scorecard.md) and rendered by
the live web viewer.

## Run it locally

```bash
pnpm install
pnpm test            # core unit tests (35)
pnpm --filter @carrybot/extension build
```

Then load the extension: open `chrome://extensions`, enable **Developer mode**,
click **Load unpacked**, and pick `apps/extension/dist`. Open a Claude
conversation and click **Carry ↗**. Add a key in the options page for the full
brief.

> **Honesty note.** The live Claude capture and the BYOK LLM call can only be
> exercised in a real logged-in browser with a real key — they are built to the
> documented endpoint shapes and covered by unit tests against recorded
> fixtures, but this repo's CI does not (and cannot) hit live Claude.

## Tech stack

TypeScript · pnpm + Turborepo · esbuild (extension) · React + Next.js + Tailwind
(web/options) · Vitest · GitHub Actions CI · MV3 service worker.

## Security & privacy

Security is a first-class concern because this repo is public and the extension
reads chat content. See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).
Short version: BYOK key in `chrome.storage.local` only, never logged, never in
git (enforced by a secret-scan pre-commit hook + CI), least-privilege
permissions, no remote code, no carrybot server.

## Status

v1 in progress. Claude only · Tier 0 + Tier 2 · the full strict brief · the eval.
Roadmap (ChatGPT/Gemini adapters, on-device Tier 1, the "simplify for a
non-technical reader" button, share links) is in the
[design spec](docs/superpowers/specs/2026-06-26-carrybot-design.md#15-scope).

## License

[MIT](LICENSE)
