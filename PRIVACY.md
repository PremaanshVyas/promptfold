# Privacy Policy

_Last updated: 2026-06-26_

carrybot is a browser extension that summarizes **your own** AI conversations
into a structured brief. This policy describes exactly what happens to your data.

## What carrybot accesses

- **Your Claude conversation content**, when you click the "Carry" button on a
  conversation you have open. It is read using your existing logged-in session,
  the same way the page loads your chat.
- **Your settings**, including your API key, which you enter in the options page.

## What carrybot does with it

- Your conversation is read **locally in your browser**.
- To produce the full brief, the conversation text is sent **only** to the AI
  provider **you** chose (Anthropic or OpenAI), using **your** API key.
- In the no-key (Tier 0) mode, your conversation **never leaves your browser** at
  all — the brief is produced entirely on-device.

## What carrybot does NOT do

- **No carrybot server.** There is no backend. Your data is never sent to us,
  because there is no "us" in the data path.
- **No account.** carrybot requires no sign-up.
- **No tracking, no analytics, no ads.** carrybot does not collect telemetry.
- **No selling or sharing** of your data. The only transmission is the brief
  request to your chosen provider, which is necessary to provide the feature.
- **Your API key** is stored on your machine (`chrome.storage.local`) and is sent
  only to your provider. It is never logged or transmitted anywhere else.

## Your provider's policy

When you use a key (Tier 2), the conversation text is processed by your chosen AI
provider under **their** privacy terms. Review Anthropic's or OpenAI's policy for
how they handle API requests.

## Data retention

carrybot stores only your settings, locally, until you remove the extension or
clear them. It keeps no copy of your conversations.

## Contact

Questions: open an issue on the GitHub repository.
