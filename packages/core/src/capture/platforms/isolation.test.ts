import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Architecture guard: adapters are isolated. Working on one chatbot must never
 * touch another, so no adapter may import a sibling adapter, they share only
 * `shared/` and the top-level types. This test fails CI on any violation
 * (the zero-dependency equivalent of dependency-cruiser / import/no-restricted-paths).
 */

const platformsDir = fileURLToPath(new URL(".", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (entry.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("adapter isolation", () => {
  const platforms = readdirSync(platformsDir).filter((e) =>
    statSync(join(platformsDir, e)).isDirectory(),
  );

  it("has one folder per platform", () => {
    expect(platforms.length).toBeGreaterThanOrEqual(7);
    expect(platforms).toContain("claude");
    expect(platforms).toContain("gemini");
  });

  it("no adapter imports another adapter", () => {
    const violations: string[] = [];
    for (const platform of platforms) {
      const others = platforms.filter((p) => p !== platform);
      for (const file of tsFiles(join(platformsDir, platform))) {
        const src = readFileSync(file, "utf8");
        for (const other of others) {
          const reachesSibling =
            new RegExp(`from\\s+["'][^"']*platforms/${other}/`).test(src) ||
            new RegExp(`from\\s+["']\\.\\./${other}/`).test(src);
          if (reachesSibling) {
            violations.push(`${platform} → ${other} (${file.split("/platforms/")[1]})`);
          }
        }
      }
    }
    expect(violations, `cross-adapter imports: ${violations.join(", ")}`).toEqual([]);
  });

  it("adapters import only from shared/, types, or their own folder", () => {
    const violations: string[] = [];
    for (const platform of platforms) {
      for (const file of tsFiles(join(platformsDir, platform))) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
          const spec = m[1] ?? "";
          const ok =
            !spec.includes("/") || // same-folder import like "./normalize.js"
            spec.startsWith("./") ||
            spec.includes("/shared/") ||
            /\.\.\/\.\.\/\.\.\/types\.js$/.test(spec) ||
            /\.\.\/\.\.\/\.\.\/\.\.\/types\.js$/.test(spec); // fixtures depth
          if (!ok) violations.push(`${platform}: ${spec}`);
        }
      }
    }
    expect(violations, `unexpected imports: ${violations.join(", ")}`).toEqual([]);
  });
});
