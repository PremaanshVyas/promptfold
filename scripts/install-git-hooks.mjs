#!/usr/bin/env node
/**
 * Installs the pre-commit hook (runs the secret scanner). Idempotent and safe:
 * does nothing outside a git repo (e.g. when installed as a dependency).
 */

import { writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const gitDir = join(root, ".git");
if (!existsSync(gitDir)) {
  // Not a git checkout (CI tarball, dependency install) — skip silently.
  process.exit(0);
}

const hooksDir = join(gitDir, "hooks");
mkdirSync(hooksDir, { recursive: true });

const hook = `#!/bin/sh
# carrybot pre-commit hook — blocks committing secrets.
node "./scripts/secret-scan.mjs" || exit 1
`;

const hookPath = join(hooksDir, "pre-commit");
writeFileSync(hookPath, hook, { mode: 0o755 });
chmodSync(hookPath, 0o755);
console.log("✓ installed pre-commit secret-scan hook");
