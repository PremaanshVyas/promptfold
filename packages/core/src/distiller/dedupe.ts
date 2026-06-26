/**
 * Collapse evolving artifact "lineages" to their latest version.
 *
 * A sandbox/writing chat saves the same file over and over (draft.md, draft2.md,
 * … final.md), each is a separate artifact, but they're really one document
 * evolving. "Latest state wins" applies to artifacts too: keep the most recent
 * version of each lineage, drop the earlier drafts. This also massively shrinks
 * what we send to the distiller (the real cause of the 5-minute, $0.25 run).
 *
 * Lineage detection is content-similarity based (Jaccard over word tokens), so
 * it's robust to filename changes (draft.md → final.md) and to edited openings.
 */

import type { Artifact } from "../types.js";

function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const DEFAULT_LINEAGE_THRESHOLD = 0.5;

/**
 * Returns artifacts with each evolving lineage collapsed to its LAST occurrence.
 * Order of first appearance is preserved; the kept item is the latest version.
 */
export function collapseArtifactLineage(
  artifacts: Artifact[],
  threshold = DEFAULT_LINEAGE_THRESHOLD,
): Artifact[] {
  const kept: Artifact[] = [];
  const keptSets: Set<string>[] = [];

  for (const art of artifacts) {
    const set = tokenSet(art.content);
    let mergedInto = -1;
    for (let i = 0; i < kept.length; i++) {
      if (jaccard(set, keptSets[i]!) >= threshold) {
        mergedInto = i;
        break;
      }
    }
    if (mergedInto >= 0) {
      kept[mergedInto] = art; // latest version wins
      keptSets[mergedInto] = set;
    } else {
      kept.push(art);
      keptSets.push(set);
    }
  }
  return kept;
}
