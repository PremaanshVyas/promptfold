# Chrome Web Store submission

Everything needed to publish PromptFold. The build and assets are done; the
remaining steps are dashboard actions only you can do (account, screenshots,
forms, submit).

## Package (ready)

- Build: `pnpm --filter @promptfold/extension build`
- Zip for upload: `apps/extension/promptfold-v0.1.0.zip` (regenerate with
  `cd apps/extension/dist && zip -rq ../promptfold-v0.1.0.zip . -x "*.map"`)
- Icons: 16 / 32 / 48 / 128, in the manifest and the package.

## Steps only you can do

1. **Developer account** at https://chrome.google.com/webstore/devconsole
   (one-time 5 USD if not already registered).
2. **New item** -> upload `promptfold-v0.1.0.zip`.
3. Fill the **store listing** (copy below).
4. Add **screenshots** (1280x800 or 640x400, at least one). Capture: the Fold
   button on a chat, the generated brief drawer, and the options page.
5. Fill the **Privacy practices** tab (justifications + data use, below).
6. **Submit for review** (Google review can take a few days to a couple weeks).

## Store listing copy

- **Name:** PromptFold
- **Summary (132 char max):**
  `Turn a long AI chat into a structured, paste-ready handoff brief. Works on Claude, ChatGPT, Gemini and more. BYOK, no server.`
- **Category:** Productivity
- **Language:** English
- **Description:**

```
PromptFold turns a long, messy AI chat into a short, structured handoff brief
you can paste into a fresh chat, a different chatbot, or hand to a teammate,
without losing anything that matters.

One click reads the whole conversation from the platform's own data layer (not a
screen scrape) and distills it into:
- Now: where the work stands
- Decided: the choices that are settled
- Open: the questions still unresolved
- Rejected (and why): dead ideas, so a fresh chatbot stops re-suggesting them
- Verbatim: code, tables, formulas, and exact values, kept byte-for-byte
- Files to attach: what to bring for full context

Works across Claude, ChatGPT, Gemini, Perplexity, Grok, DeepSeek, and HuggingChat,
reading each platform's own conversation API for a complete capture.

Bring your own key (BYOK): without a key you still get a complete on-device
capture; add your own Anthropic or OpenAI key for the full reasoned brief. No
accounts, no daily limits, no middleman server. Your chat is read locally and sent
only to the provider you chose with your key.
```

- **Privacy policy URL:**
  `https://github.com/PremaanshVyas/promptfold/blob/main/PRIVACY.md`

## Privacy practices tab

- **Single purpose:** Summarize the user's own open AI chat conversation into a
  structured handoff brief they can carry to another chat or teammate.
- **Permission justifications:**
  - `storage`: store the user's settings, their API key, and a local
    per-conversation brief cache, all on the user's own machine.
  - `host_permissions` (claude.ai, chatgpt.com / chat.openai.com,
    gemini.google.com, *.perplexity.ai, grok.com, chat.deepseek.com,
    huggingface.co): fetch the user's own conversation from each platform's API
    using their existing logged-in session.
  - `host_permissions` (api.anthropic.com, api.openai.com): send the conversation
    to the user's chosen LLM provider (Anthropic or OpenAI) with the user's own key.
- **No broad permissions:** there is no `<all_urls>` and no
  `optional_host_permissions`. The extension injects and fetches only on the
  hosts listed above.
- **Data usage:** Reads conversation content and the user's settings. Conversation
  text is sent only to the user's chosen AI provider to produce the brief. No data
  is collected by the developer, sold, or shared; there is no analytics and no
  backend server. The API key is stored locally (chrome.storage.local) and sent
  only to the chosen provider.

The earlier review-friction items are resolved: the custom-endpoint feature
(and its broad `https://*/*` permission) was removed, and the content scripts
are trimmed to the seven supported platforms only.
```
</content>
