# Security

carrybot reads your AI chat content, so security is a first-class concern, and
this is a public repository, so nothing sensitive must ever land in it.

## Threat model & guarantees

- **Your API key never leaves your machine** except in the direct HTTPS call to
  the provider *you* chose (Anthropic or OpenAI). It is stored with
  `chrome.storage.local`, read only by the service worker, never logged, never
  injected into the page, and never sent to any carrybot server, there is none.
- **No middleman.** There is no carrybot backend. Capture happens in your
  browser; distillation is a direct call from the extension to your provider.
- **Least privilege.** The extension requests only `storage`, `activeTab`,
  `scripting`, and host permissions for `claude.ai` plus the two LLM API hosts.
  No `<all_urls>`.
- **No remote code.** MV3's rule is enforced: all logic is bundled; the extension
  never loads or evals external scripts.
- **Injected UI is sandboxed** in a Shadow DOM and built with `textContent`
  (never `innerHTML`), so untrusted chat content cannot inject markup or script.

## Keeping secrets out of the repo

Defense in depth:

1. **`.gitignore`** (committed before any code) blocks `.env*`, `*.key`, `*.pem`,
   raw chat captures, and build output.
2. **Secret-scan pre-commit hook** (`scripts/secret-scan.mjs`, installed by
   `pnpm install`) blocks committing API keys, private keys, or credential
   literals, even pasted into a tracked file.
3. **CI runs the same scan** across the whole tree on every push/PR.

Run it manually:

```bash
node scripts/secret-scan.mjs --all
```

## Eval fixtures

Only **sanitized, synthetic** conversations are committed. Real chats captured
from your own account belong in `eval/fixtures/` (git-ignored) or `fixtures/raw/`
and must be sanitized before being committed.

## Platform terms (ToS)

carrybot reads *your own* conversation data with *your own* session, the
Export-Data category, and distills it with *your own* LLM key. It **never**
routes your Claude session for inference (the pattern that gets accounts banned).
Capture is on-demand, one conversation per click, never bulk-looped. The internal
endpoint is undocumented and may change; this is a personal/portfolio tool, used
at your own risk, and is not affiliated with or endorsed by Anthropic.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or email the
maintainer. Please do not file public issues for security problems.
