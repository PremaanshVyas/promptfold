# PromptFold

**One click turns a long AI chat into a short, structured handoff brief.**
PromptFold injects a **Fold** button into your AI chat. One click reads the whole
conversation from the platform's own data layer and distills it into a compact
brief, **Now / Decided / Open / Rejected / Verbatim / Files-to-attach**, that you
can paste into a fresh chat, a different chatbot, or hand to a teammate without
losing anything that matters.

> Carry the context to your next chat, or to your teammate.

It works across **seven** chatbots from their data layer (Claude, ChatGPT,
Gemini, Perplexity, Grok, DeepSeek, HuggingChat) and degrades gracefully to a DOM
read on anything else.

---

## Why it exists

Long AI chats die. They slow down near the context limit, the next person cannot
read 200 messages to catch up, and a fresh chatbot keeps re-suggesting ideas you
already ruled out. Most "chat exporters" dump the raw transcript, which just moves
the mess somewhere else. PromptFold keeps the **state and the decisions**, not the
mess. The shrinking is the value: it captures all 200 messages, then deliberately
produces something smaller and load-bearing.

## What makes it different

- **Rejected, with the reason why, as its own section.** The piece nobody else
  carries, and the reason a fresh chatbot re-suggests dead ideas. PromptFold
  records what was ruled out and why, so the next session does not relitigate it.
- **Read from the data layer, not the screen.** It calls each platform's own
  conversation API with your existing session, so it captures artifacts, canvas
  documents, code, tables, and citations that DOM scrapers miss.
- **Latest state wins.** If a value changed over the chat (a timeout of 30 that
  became 60), the brief carries 60, never the stale 30.
- **Load-bearing content is guaranteed, not hoped for.** Tables, images, code,
  spreadsheet formulas, and the files-to-attach list are extracted
  deterministically and force-merged into the brief, so the language model cannot
  quietly summarize a table into prose or drop a deliverable.
- **No key-or-nothing wall.** Without an API key you still get a complete
  deterministic brief (exact capture plus extracted verbatim plus the
  files-to-attach manifest), produced entirely on your device.
- **Proof, not promises.** A shipped [eval](#the-eval-the-proof) measures whether a
  brief preserves everything a next session needs.

## Supported platforms

Seven precise **data-layer** adapters, each reading the platform's own
conversation endpoint with your logged-in session:

| Platform | Host | How it is read |
|---|---|---|
| **Claude** | `claude.ai` | cookie session, `GET /api/organizations/{org}/chat_conversations/{id}?tree=True&rendering_mode=messages&render_all_tools=true`, artifacts and tool output included |
| **ChatGPT** | `chatgpt.com`, `chat.openai.com` | bearer from `/api/auth/session`, then `/backend-api/conversation/{id}`, walks the message tree, replays Canvas docs |
| **Gemini** | `gemini.google.com` | Google `batchexecute` RPC (`hNvQHb`) with the page `SNlM0e` token, positional array parsing (experimental, version-fragile) |
| **Perplexity** | `*.perplexity.ai` | cookie session, `GET /rest/thread/{slug}`, answer plus sources |
| **Grok** | `grok.com` | cookie session, `GET /rest/app-chat/conversations/{id}/responses?includeThreads=true` |
| **DeepSeek** | `chat.deepseek.com` | bearer read from `localStorage.userToken`, `GET /api/v0/chat/history_messages` |
| **HuggingChat** | `huggingface.co/chat` | cookie session, `GET /chat/api/conversation/{id}` |

Anything else falls back to a **generic DOM reader** that scrapes the visible
messages. It is lower fidelity and labels itself honestly (`read from screen`), so
you always know whether the capture was complete. A data-layer adapter that fails
at runtime also falls back to the DOM read rather than erroring out.

## Tiers

Nobody hits a "key or nothing" wall.

| Tier | Needs | What you get |
|---|---|---|
| **0** | nothing | A complete deterministic brief: exact capture plus extracted verbatim (code, tables, images, spreadsheet formulas, numbers, API contracts) plus the files-to-attach manifest. Produced on-device, instantly. No reasoning sections (those need a model). |
| **2** | your own API key (BYOK) | The full reasoned brief, **Now / Decided / Open / Rejected**, for any length, via a chunk-then-merge pipeline. |

**No accounts. No daily limits. No length caps. No middleman server.** Your chat is
read locally and sent only to the provider you chose with your own key.

## How it works

### Capture (`packages/core/src/capture`)

Ports-and-adapters. A small shared contract (`CaptureAdapter`) and one folder per
platform under `capture/platforms/`. Adapters never import each other; they share
only `capture/shared/` and the top-level types. **The boundary is enforced by a
guard test** (`capture/platforms/isolation.test.ts`) that fails CI if any adapter
reaches into a sibling, so working on one chatbot's quirks can never break
another. Each adapter normalizes its platform's wire format into one
`NormalizedTranscript`, and emits an **integrity report** so completeness is
provable rather than assumed (every content block is either classified or
surfaced loudly, never dropped silently).

### Distill (`packages/core/src/distiller`)

Two tiers over the same normalized transcript:

- **Tier 0, deterministic.** Pure functions, no model. Extract tables, images,
  code, spreadsheet formulas, numbers, API contracts, and the files-to-attach
  list. Reconstruct the true final state of sandbox files by replaying their edit
  operations (`create_file`, `str_replace`, `mv`), so a file built over ten edits
  is captured once, finished, under its delivered name.
- **Tier 2, language model.** Chunk the transcript, distill each chunk into a
  mini-brief concurrently, then **merge** with latest-state-wins and supersession
  (a decision later reversed moves to Rejected; an answered question moves to
  Decided; an unresolved caveat stays Open). The model output is then reconciled
  against the deterministic facts: produced files are authoritative, tables and
  images are force-guaranteed, the produced-file count is enforced in `Now`, and
  remarks about the brief itself are stripped. On a parse failure it falls back to
  the deterministic brief and says so loudly rather than inventing structure.

The distiller is fully unit-tested with a fake model client, so the whole
pipeline (chunking, merge, supersession, the guarantees) runs in CI without a key.

### Brief (`packages/core/src/brief`)

Renders the brief state into two text framings from one engine: a clean markdown
brief and a "resume in a new chat" prompt with framing headers.

## The eval (the proof)

Give a fresh model only the brief, and separately the full chat. Ask both the same
next question. If the brief-only answer makes the same next move, the brief kept
everything load-bearing.

```bash
pnpm eval                          # shape + size report, no key needed
PROMPTFOLD_API_KEY=... pnpm eval   # full same-next-move judgement
```

Results land in [`eval/scorecard.md`](eval/scorecard.md) and render in the web
viewer (`apps/web`).

## Architecture

A pnpm + Turborepo monorepo. The signal worth noticing is `packages/core`: one
framework-agnostic brain (no DOM, no `Date.now`, no UI) consumed by both the
extension's vanilla content script and the React web app.

```
PromptFold/
  packages/core/      the brain: capture (per-platform adapters), distiller, brief, types
  apps/extension/     MV3 extension: vanilla TS + Shadow DOM injected UI, React options page
  apps/web/           Next.js + Tailwind: landing + live eval-results viewer
  eval/               the proof harness (brief vs full chat)
  scripts/            secret-scan + git-hook installer
```

Three boundaries, each testable on its own: **capture** (platform data to a
normalized transcript), **distiller** (transcript to brief state), **brief** (state
to text). The injected UI mounts in a **Shadow DOM**, so the host page's CSS and
PromptFold's never collide, and it is built with `textContent` only (never
`innerHTML`), so untrusted chat content cannot inject markup or script.

## Run it locally

```bash
pnpm install                                  # also installs the secret-scan git hook
pnpm test                                     # 100+ unit tests, no key needed
pnpm --filter @promptfold/extension build     # bundles to apps/extension/dist
```

Then load the extension: open `chrome://extensions`, turn on **Developer mode**,
click **Load unpacked**, and pick `apps/extension/dist`. Open a supported chat and
click **Fold** in the bottom corner. Without a key you get the Tier 0 brief
immediately. To unlock the reasoned sections, open the options page and add your
own API key (Anthropic, OpenAI, or any OpenAI-compatible endpoint).

> **Honesty note.** The live captures and the BYOK model call can only run in a
> real logged-in browser with a real key. They are built to each platform's
> documented endpoint shapes and covered by unit tests against recorded fixtures,
> but this repo's CI does not, and cannot, hit live providers. The Gemini adapter
> in particular reads an undocumented internal RPC and is marked experimental.

## Security and privacy

Security is a first-class concern: the extension reads chat content and this repo
is public. Full detail in [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).
Short version:

- **BYOK key** lives in `chrome.storage.local` only, is read only by the service
  worker, is never logged, and is sent only to the provider you chose.
- **No PromptFold server.** Capture happens in your browser; distillation is a
  direct call from the extension to your provider. There is no backend in the data
  path, so there is nothing to ration, log, or breach.
- **No remote code.** MV3's rule is enforced: everything is bundled by esbuild; the
  extension never loads or evals external script.
- **Secrets cannot enter git.** A `.gitignore` written before any code, plus a
  secret-scan pre-commit hook and the same scan in CI.
- **Least privilege.** Standard permissions are `storage`, `activeTab`,
  `scripting`. Host permissions cover the supported chat hosts and the LLM API
  hosts. A custom OpenAI-compatible endpoint requires the broad
  `optional_host_permissions`, granted narrowly at runtime only for the origin you
  type. See SECURITY.md for the exact set and rationale.

## Tech stack

TypeScript, pnpm + Turborepo, esbuild (extension bundle), React with Next.js and
Tailwind (web and options pages), Vitest, GitHub Actions CI, an MV3 service worker.
Zero runtime dependencies in `packages/core`.

## Status

Working: seven data-layer adapters plus the DOM fallback, Tier 0 and Tier 2, the
full strict brief, the eval, and the security tooling. On the roadmap: an on-device
small-model Tier 1, a "simplify for a non-technical reader" framing, and share
links.

## License

[MIT](LICENSE)
</content>
</invoke>
