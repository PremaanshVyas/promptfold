/**
 * Eval CLI.
 *
 *   pnpm eval                       # no key → brief-shape + size report
 *   PROMPTFOLD_API_KEY=… pnpm eval    # also runs the same-next-move judgement
 *
 * Writes:
 *   - eval/scorecard.json   (machine-readable, also consumed by apps/web)
 *   - eval/scorecard.md     (human-readable summary)
 *   - apps/web/public/scorecard.json (so the live viewer renders it)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeLlmClient, DEFAULT_MODELS, type Provider } from "@promptfold/core";
import { runFixture, type EvalEntry } from "./harness.js";
import { FIXTURES } from "./fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function buildClient() {
  const apiKey = process.env.PROMPTFOLD_API_KEY;
  if (!apiKey) return undefined;
  const provider = (process.env.PROMPTFOLD_PROVIDER as Provider) ?? "anthropic";
  const model = process.env.PROMPTFOLD_MODEL ?? DEFAULT_MODELS[provider];
  return makeLlmClient({ provider, apiKey, model });
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function toMarkdown(entries: EvalEntry[], judged: boolean, model: string): string {
  const lines: string[] = [];
  lines.push("# promptfold eval scorecard\n");
  lines.push(
    judged
      ? `Mode: **full judgement** (model: \`${model}\`). Each row asks a fresh model the same next question from the brief alone vs the full chat, then checks they make the same move.\n`
      : "Mode: **shape + size only** (no API key). Set `PROMPTFOLD_API_KEY` to run the same-next-move judgement.\n",
  );
  lines.push("| Fixture | Full→Brief size | Integrity | Decided/Open/Rejected/Verbatim/Files | Same next move? |");
  lines.push("|---|---|---|---|---|");
  for (const e of entries) {
    const s = e.sections;
    const move = e.judged ? (e.judged.sameMove ? "✅ yes" : "❌ no") : ", ";
    lines.push(
      `| ${e.id} | ${e.fullChars}→${e.briefChars} (−${pct(e.reduction)}) | ${
        e.integrityComplete ? "✓" : "⚠ partial"
      } | ${s.decided}/${s.open}/${s.rejected}/${s.verbatim}/${s.files} | ${move} |`,
    );
  }
  if (judged) {
    const pass = entries.filter((e) => e.judged?.sameMove).length;
    lines.push(`\n**Same-next-move pass rate: ${pass}/${entries.length}**\n`);
    lines.push("\n## Judge reasoning\n");
    for (const e of entries) {
      if (e.judged) lines.push(`- **${e.id}**: ${e.judged.reasoning}`);
    }
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const client = buildClient();
  const model = client?.id ?? "(none)";
  const capturedAt = "2026-06-26T00:00:00Z"; // fixed for reproducible scorecards

  console.log(
    client
      ? `Running full judgement with ${model}…`
      : "Running shape+size report (no key). Set PROMPTFOLD_API_KEY for full judgement.",
  );

  const entries: EvalEntry[] = [];
  for (const fixture of FIXTURES) {
    process.stdout.write(`  • ${fixture.id} … `);
    const entry = await runFixture(fixture, { capturedAt, ...(client ? { client } : {}) });
    entries.push(entry);
    console.log(
      entry.judged
        ? entry.judged.sameMove
          ? "same move ✅"
          : "diverged ❌"
        : `−${pct(entry.reduction)} smaller`,
    );
  }

  const scorecard = {
    generatedFor: model,
    judged: Boolean(client),
    entries,
  };

  await writeFile(
    resolve(__dirname, "../scorecard.json"),
    JSON.stringify(scorecard, null, 2),
  );
  await writeFile(
    resolve(__dirname, "../scorecard.md"),
    toMarkdown(entries, Boolean(client), model),
  );
  const webPublic = resolve(repoRoot, "apps/web/public");
  await mkdir(webPublic, { recursive: true });
  await writeFile(
    resolve(webPublic, "scorecard.json"),
    JSON.stringify(scorecard, null, 2),
  );

  console.log("\n✓ wrote eval/scorecard.json, eval/scorecard.md, apps/web/public/scorecard.json");
  if (client) {
    const pass = entries.filter((e) => e.judged?.sameMove).length;
    console.log(`Same-next-move pass rate: ${pass}/${entries.length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
