#!/usr/bin/env node
/**
 * Secret scanner, blocks committing API keys, private keys, or .env contents.
 *
 * Runs in the pre-commit hook against STAGED content only, and in CI against
 * the whole tree. Exit non-zero on any finding. This is defense-in-depth on top
 * of .gitignore: .gitignore stops files; this stops a secret pasted into a
 * tracked file (README, test, comment).
 *
 * Zero dependencies, runs anywhere Node runs.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const RULES = [
  { name: "Anthropic API key", re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: "OpenAI API key", re: /sk-(?:proj-)?[a-zA-Z0-9]{20,}/ },
  { name: "AWS access key id", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Generic bearer secret", re: /\b(secret|token|password|passwd|api[_-]?key)\b\s*[:=]\s*['"][^'"]{12,}['"]/i },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Stripe secret key", re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "Google OAuth client secret", re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/ },
];

// Allow obvious placeholders so docs/examples don't trip the scanner.
const ALLOW = [
  /sk-ant-xxxx/i,
  /your[_-]?api[_-]?key/i,
  /<your-key>/i,
  /example|placeholder|dummy|REDACTED|xxxxxxxx/i,
];

function stagedFiles() {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf8",
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function allTrackedFiles() {
  const out = execSync("git ls-files", { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

const mode = process.argv.includes("--all") ? "all" : "staged";
const files = mode === "all" ? allTrackedFiles() : stagedFiles();

// Never scan the scanner itself (it contains the patterns) or lockfiles.
const SKIP = [/scripts\/secret-scan\.mjs$/, /pnpm-lock\.yaml$/, /\.png$|\.jpg$|\.gif$|\.ico$/];

let findings = 0;
for (const file of files) {
  if (SKIP.some((re) => re.test(file))) continue;
  if (!existsSync(file)) continue;
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue; // binary / unreadable
  }
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    if (ALLOW.some((re) => re.test(line))) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        console.error(`✗ ${rule.name} in ${file}:${i + 1}`);
        findings++;
      }
    }
  });
}

if (findings > 0) {
  console.error(`\n🚫 Secret scan blocked the commit: ${findings} potential secret(s).`);
  console.error("Remove the secret (use .env, which is git-ignored) and try again.");
  process.exit(1);
}
console.log(`✓ secret-scan: no secrets found (${files.length} file(s), ${mode}).`);
