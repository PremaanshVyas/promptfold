# Handoff — Product & Build Spec

*(“Handoff” is a placeholder name — rename later.)*

---

## 1. What it is, in one line

A Chrome extension that lives **inside** your AI chat (Claude first). You hit one button, and it turns the whole conversation — however long and messy — into a short, clean, structured **brief** you can paste into a fresh chat, a different chatbot, or hand to a teammate, without losing anything that matters.

---

## 2. The problem it solves

Long AI chats die. They get slow and dumb near their limit, the next person can’t read 200 messages to catch up, and a fresh chatbot has no idea what you already decided or already ruled out. Every existing tool “solves” this by dumping the raw transcript — which just moves the mess somewhere else.

Handoff doesn’t move the mess. It throws the mess away and keeps the truth.

## 3. Why an extension, not a website

People don’t want to visit a new site — they all look the same now. The button appears right where you’re already working, at the exact moment you need it. Nothing to visit, nothing to learn. That’s the whole distribution advantage, and it’s why this is an extension and not a web app.

---

## 4. Four principles the whole thing is built on

1. **Read the data, not the screen.** When you read a chat, the app first downloads the conversation as a hidden data file, *then* draws the bubbles, code boxes, tables, and side-panel artifacts. Most export tools grab the drawn screen — that’s why they miss things in separate boxes. Handoff grabs the hidden data, where nothing is separated. Everything is in there, exact.
2. **Keep state, not summary.** A summary tells you *what happened*. Handoff tells you *where things stand* — what’s decided, what’s open, what’s ruled out. That’s what “resume” actually needs.
3. **Capture everything, keep only what matters.** It grabs all 200 messages, then deliberately produces something *smaller*. The shrinking is the value, not a loss.
4. **High fidelity with honest fallback.** Aim for near-perfect, not “never fails.” If it ever hits something it can’t parse, it shows the raw version loudly instead of silently dropping it.

---

## 5. The output: the Handoff brief

Every brief has these sections.

**Decided** — what’s locked. Don’t relitigate.

**Open** — the live, unresolved threads. This is where the next person picks up.

**Rejected** — what was tried and ruled out, **and why**. The piece nobody else carries — it’s why fresh chatbots keep re-suggesting dead ideas. Handoff stops that.

**Verbatim** — the exact stuff that must survive byte-for-byte: real names, file paths, numbers, API details, the precise wording of a constraint, and the **final** version of any code. Small code stays here inline; big code becomes an attachment (see next section). The apologies, false starts, and “no still broken” get compressed to nothing.

**Bring these for full context** — a short checklist of files to attach so the new chatbot sees the whole picture, not just fragments. Two kinds go here:
- **Big things from the chat** that are better as a file than as pasted text (e.g. a 600-line file the assistant rewrote five times → keep the final version as a named attachment, not dumped inline).
- **Things the chat only *referred* to but never actually contained** (e.g. your real `upload_handler.py` from your repo, or an `api_specs.json` that was mentioned but never shown).

Each item gets **one line saying why it matters** — e.g. “attach the real `upload_handler.py`, because the chat only ever saw a 12-line snippet, not the full function with the checksum step.” That turns a vague list into real instructions for the receiving chatbot.

> Honest limit: Handoff can *name* the files to attach and say why, but it can’t reach into your computer or private repo to grab them — you attach them. Its job is to make sure you never have to *guess* what’s missing.

### One subtle rule: latest state wins
Over a long chat, a value changes — say a timeout was 30 at message 40, then 60 at message 150. The brief must show **60** (the final state), never both, and never the stale 30. “Keep every updated variable” means *keep where each one ended up*, resolved across the whole chat. (Full history of how a value changed is a separate optional mode — “show the trail” — not the default.)

---

## 6. How capture works (the hard, valuable part)

When you click **Export**, the extension asks Claude’s servers for the **full conversation** using your existing logged-in session — the same request the page itself makes when it loads your chat. It gets back the complete record as structured data: every message, every code block, and every artifact (including the side-panel ones that never appear in the chat column).

Two practical notes:
- The conversation ID is right there in the page URL. The extension uses that plus your normal session to fetch the complete conversation tree.
- This reads **your own** chat data — the same thing Anthropic’s own “Export Data” feature gives you. Be polite to the servers (fetch on demand, don’t hammer), and respect each platform’s terms.

Start with **Claude only**. Get one platform near-perfect — artifacts included — before adding ChatGPT, Gemini, etc. Each one stores its data differently, so each is its own small adapter.

---

## 7. How the brief gets made (the distiller)

The captured conversation goes to an AI model with a careful instruction set that produces the brief sections above.

**Long chats need chunking.** A 200-message chat is often too big to read in one pass. So the distiller reads it in chunks, makes a mini-brief of each, then **merges** them into one. The merge step is exactly where “latest state wins” gets enforced — that’s where the old 30 gets replaced by the final 60.

**Keep-vs-crush rules the distiller follows:**
- Keep exact: code (final version), names, paths, numbers, API contracts, precise constraint wording.
- Compress to nothing: apologies, dead ends, re-explanations, “try this / no that failed” loops.
- For each decision, also record what it *replaced* or *ruled out*, so Rejected stays accurate.

**Bring-your-own-key (BYOK).** The user supplies their own AI API key, stored locally on their machine. Handoff never bills for tokens — the user pays their provider directly. This keeps it cheap to run and avoids you fronting anyone’s costs.

---

## 8. How you prove it actually works (the eval)

This is what makes it a serious project instead of a demo.

Give a fresh model **only the brief**, and separately give it the **full original chat**. Ask both the same next question. If the brief version makes the same next move as the full-chat version, your brief kept everything load-bearing. You can score this across many real chats. Shipping the tool *plus* this proof is a completely different signal than shipping a pretty button.

---

## 9. The interface

- An **Export chat** button, injected into the chat near the message box.
- Click it → a quick “reading conversation…” beat → the **brief slides in** as a side drawer.
- Brief shows the sections from §5, with Verbatim as a clearly-marked exact block.
- Footer actions:
  - **Copy brief** (the main one).
  - **Copy as resume prompt** — same content wrapped in a “here’s where we were, continue from here” framing to paste into any chatbot.
  - **Share link** (optional, secondary).
- A small **“read from data layer”** marker, so it’s clear this is the complete record, not a screen-scrape.

**Not in v1:** the sync / save-as-you-go button. Because capture already grabs the whole chat fresh on every click, sync solves a problem you mostly don’t have yet. Add it later as an optional toggle if giant chats or cost become a real pain.

---

## 10. Scope

**v1 (build this):**
- Claude only.
- One-click capture from the data layer, complete (artifacts included).
- Distiller producing the full brief incl. “bring these for full context.”
- Copy brief + copy as resume prompt.
- BYOK settings screen.
- A small eval you can run on your own chats.

**Later:**
- ChatGPT / Gemini / others (one adapter each).
- Sync / incremental updates for very long chats.
- Share links with a hosted render.
- “Show the trail” mode for variable history.
- Teammate review (comment on a brief).

---

## 11. Tech stack

- **Extension:** Manifest V3, plain JS or TypeScript. A content script for the button + capture, a small background service worker, a popup/options page for the API key.
- **Distiller:** call an LLM API (Anthropic or OpenAI) directly from the extension using the user’s key.
- **UI:** vanilla + CSS is fine for v1 (the mockup already proves the look); React only if it earns its place.
- **Storage:** `chrome.storage.local` for the API key and settings. Nothing leaves the user’s machine except the call to their chosen AI provider.

---

## 12. Privacy (say this clearly to users)

- The chat is read locally in your browser.
- It’s sent **only** to the AI provider *you* chose with *your* key, to make the brief.
- No Handoff server in the middle, no account needed for v1.
- Your API key is stored on your machine only.

---

## 13. Honest risks

- **You don’t control the platforms.** Claude can change how its data is shaped; your capture adapter will need occasional fixing. This is the real maintenance cost.
- **“Never fails” isn’t reachable.** Promise high fidelity + loud fallback instead.
- **Rate limits / terms.** Reading your own chats is legitimate, but fetch on demand and stay within each platform’s rules.

---

# How to build the Chrome extension — step by step

A Chrome extension is just a folder of files Chrome loads. Here’s the path from empty folder to working tool.

### Step 0 — Set up
Make a folder. Inside it you’ll have a `manifest.json` (the extension’s ID card), and a few JS/HTML files. You don’t need a build tool to start — plain files work.

### Step 1 — The manifest
`manifest.json` declares the extension: its name, that it’s Manifest V3, which sites it’s allowed to run on (Claude’s domain), and which files are the content script, background worker, and options page. This is the first thing Chrome reads.

### Step 2 — Load it once, so you can test as you go
In Chrome: go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick your folder. It now runs. Every time you change a file, hit the refresh icon on that extensions page. Keep this loop tight.

### Step 3 — Put the button on the page (content script)
The content script runs on Claude’s pages. Its first job: find the right spot near the message box and inject your **Export** button. Get this working first with the button just showing an alert — prove you can place UI inside the real site before doing anything clever.

### Step 4 — Capture the conversation
When the button is clicked:
- Read the conversation ID from the page URL.
- Use the user’s existing logged-in session to fetch the full conversation from Claude’s servers (the same request the page makes to load your chat).
- You now have the complete record as data — messages, code, artifacts.

Test this hard. Print it out, eyeball it, confirm the side-panel artifact and code blocks are all present and exact. **This step is the foundation — everything sits on it.**

### Step 5 — Make the brief (distiller)
- Add an **options page** where the user pastes their AI API key; save it with `chrome.storage.local`.
- Send the captured conversation + your instruction set to the AI provider.
- For long chats, chunk → mini-brief each chunk → merge (this is where “latest value wins” happens).
- Get back the structured brief.

### Step 6 — Show the brief
Render the drawer from the mockup: the Decided / Open / Rejected / Verbatim / Bring-these sections, plus **Copy brief** and **Copy as resume prompt**. Copy is one line of code (`navigator.clipboard.writeText`).

### Step 7 — Prove it (eval)
Take a handful of your own real long chats. For each: brief vs. full chat, same next question to a fresh model, compare. Fix the instruction set until the brief consistently wins. This is your quality bar and your portfolio centerpiece.

### Step 8 — Polish & publish
Tidy the fallback behavior (show raw when unsure), write a clear privacy note, make a short demo video, and submit to the Chrome Web Store (one-time developer registration, a small fee, a review wait).

---

## Suggested build order (don’t skip ahead)
1. Button shows up inside Claude.
2. Capture a complete chat into clean data (artifacts included).
3. Turn a short chat into a correct brief.
4. Handle long chats (chunk + merge, latest-value-wins).
5. Add the drawer UI + copy buttons.
6. Add the eval, tune until it passes.
7. Polish, privacy, publish.

The make-or-break step is **#2**. If capture is complete and exact, everything after it is achievable. If capture is flaky, nothing else matters. Build and trust that one first.
