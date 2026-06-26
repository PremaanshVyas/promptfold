#!/usr/bin/env node
/**
 * esbuild bundler for the MV3 extension.
 *
 * Bundles three entry points to plain files Chrome loads directly:
 *   content.js: injected into claude.ai (capture + Shadow-DOM drawer)
 *   worker.js:  service worker (BYOK LLM calls; key never enters the page)
 *   options.js . React settings page
 *
 * MV3 forbids remote code, so EVERYTHING is bundled, no CDN, no eval.
 *
 * A tiny resolver rewrites `./x.js` → `./x.ts`, because @carrybot/core is
 * authored as TS with ESM-style .js import specifiers.
 */

import { build, context } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(__dirname, "dist");
const watch = process.argv.includes("--watch");

/** Resolve relative `.js` specifiers to their `.ts` source when present. */
const tsResolvePlugin = {
  name: "js-to-ts",
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind === "entry-point" || !args.path.startsWith(".")) return;
      const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
      if (existsSync(tsPath)) return { path: tsPath };
      return; // let esbuild handle real .js
    });
  },
};

const shared = {
  bundle: true,
  format: "esm",
  target: "chrome120",
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
  plugins: [tsResolvePlugin],
  define: { "process.env.NODE_ENV": '"production"' },
};

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await copyFile(
    resolve(__dirname, "manifest.json"),
    resolve(outdir, "manifest.json"),
  );
  await copyFile(
    resolve(__dirname, "src/options/options.html"),
    resolve(outdir, "options.html"),
  );
}

async function run() {
  await rm(outdir, { recursive: true, force: true });
  await copyStatic();

  const opts = {
    ...shared,
    entryPoints: {
      content: resolve(__dirname, "src/content/index.ts"),
      worker: resolve(__dirname, "src/worker/index.ts"),
      options: resolve(__dirname, "src/options/index.tsx"),
    },
    outdir,
  };

  if (watch) {
    const ctx = await context(opts);
    await ctx.watch();
    console.log("watching for changes…");
  } else {
    await build(opts);
    console.log("✓ built extension → dist/");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
