# PromptFold

**One-click context handoff from your AI chat.** PromptFold lives inside Claude.ai.
One click turns a long, messy conversation into a short, structured **brief**
(Decided / Open / Rejected / Verbatim / Files-to-attach) that you can paste into
a fresh chat, a different chatbot, or hand to a teammate, without losing anything
that matters.

> Carry the context to your next chat, or to your teammate.

---

## Why this exists

Long AI chats die. They get slow near their limit, the next person cannot read
200 messages to catch up, and a fresh chatbot keeps re-suggesting ideas you
already ruled out. Most tools "solve" this by dumping the raw transcript, which
just moves the mess somewhere else. PromptFold keeps the state and the decisions,
not the mess.

The shrinking is the value. It captures all 200 messages, then deliberately
produces something smaller.

## What makes it different

The chat-export space is crowded, so PromptFold is sharp about where it wins (see
the [full competitive analysis](docs/superpowers/specs/2026-06-26-promptfold-design.md)):

- **Rejected, with the reason why, as its own section.** The piece nobody else
  carries. It is why fresh chatbots re-suggest dead ideas, and PromptFold stops that.
- **A files-to-attach manifest**, each item with one line on why it matters,
  including files the chat only referred to but never contained.
- **Latest state wins.** If a value changed over the chat (a word count of 750
  that became 748), the brief shows 748, never the stale 750.
- **Read from the data layer, not the screen.** It fetches the conversation from
  Claude's API, artifacts included, so it never misses side-panel content the way
  DOM scrapers do.
- **Proof, not promises.** A [shipped eval](#the-eval-the-proof) measures whether
  a brief preserves everything load-bearing. No competitor ships that.

## Tiers

Nobody hits a "key or nothing" wall.

| Tier | Needs | What you get |
|---|---|---|
| **0** | nothing | Complete, exact capture plus extracted verbatim (code, paths, numbers, APIs) plus the files-to-attach list. Works everywhere, instantly. |
| **2** | your own API key (BYOK) | The full structured brief with real reasoning, any length, via chunk then merge. |

**No accounts. No daily limits. No length caps. No middleman server.** Your chat
is read locally and sent only to the provider you chose with your key. We cannot
ration what we never see.

## Architecture

A pnpm and Turborepo monorepo. The signal worth noticing is `packages/core`: one
framework-agnostic brain consumed by both the vanilla content script and the
React web app.

```
PromptFold/
  packages/core/      framework-agnostic brain: capture, distiller, brief (Vitest)
  apps/extension/     MV3 extension: vanilla TS + Shadow DOM injected UI, React options
  apps/web/           Next.js + Tailwind: live eval-results viewer + landing
  eval/               the proof harness (brief vs full chat)
  docs/               design spec, privacy, security
```

Three boundaries, each testable on its own: **capture** (Claude data to a
normalized transcript), **distiller** (transcript to brief state), **brief**
(state to two text framings). The injected UI mounts in a Shadow DOM, so Claude's
CSS and PromptFold's never collide.

## The eval (the proof)

Give a fresh model only the brief, and separately the full chat. Ask both the
same next question. If the brief-only answer makes the same next move, the brief
kept everything that mattered.

```bash
pnpm eval                        # shape + size report (no key needed)
PROMPTFOLD_API_KEY=... pnpm eval    # full same-next-move judgement
```

Results land in [`eval/scorecard.md`](eval/scorecard.md) and render in the web
viewer.

## Run it locally

```bash
pnpm install
pnpm test
pnpm --filter @promptfold/extension build
```

Then load the extension: open `chrome://extensions`, turn on **Developer mode**,
click **Load unpacked**, and pick `apps/extension/dist`. Open a Claude
conversation and click **Carry**. Add a key in the options page for the full brief.

> **Honesty note.** The live Claude capture and the BYOK model call can only be
> exercised in a real logged-in browser with a real key. They are built to the
> documented endpoint shapes and covered by unit tests against recorded fixtures,
> but this repo's CI does not, and cannot, hit live Claude.

## Tech stack

TypeScript, pnpm and Turborepo, esbuild for the extension, React with Next.js and
Tailwind for the web and options pages, Vitest, GitHub Actions CI, an MV3 service
worker.

## Security and privacy

Security is a first-class concern because this repo is public and the extension
reads chat content. See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).
Short version: the BYOK key lives in `chrome.storage.local` only, is never logged
and never enters git (a secret-scan pre-commit hook and CI enforce that),
permissions are least-privilege, there is no remote code, and there is no
PromptFold server.

## Status

v1 in progress: Claude only, Tier 0 and Tier 2, the full strict brief, the eval.
The roadmap (ChatGPT and Gemini adapters, on-device Tier 1, the "simplify for a
non-technical reader" button, share links) is in the
[design spec](docs/superpowers/specs/2026-06-26-promptfold-design.md#15-scope).

## License

[MIT](LICENSE)
