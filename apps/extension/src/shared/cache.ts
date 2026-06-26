/**
 * Per-conversation brief cache. Reopening "Carry" on a chat you've already
 * distilled should show the saved brief instantly (and let you Regenerate),
 * not silently re-run an expensive distill.
 *
 * Stored in chrome.storage.local keyed by conversation id. Briefs are small
 * (tens of KB), well within the local quota.
 */

import type { BriefState, BriefFramings } from "@carrybot/core";

export interface CachedBrief {
  state: BriefState;
  framings: BriefFramings;
  producedBy: string;
  /** ISO timestamp the brief was generated. */
  savedAt: string;
}

const PREFIX = "carrybot.brief.";

export async function loadCachedBrief(
  conversationId: string,
): Promise<CachedBrief | null> {
  const key = PREFIX + conversationId;
  const got = await chrome.storage.local.get(key);
  return (got[key] as CachedBrief | undefined) ?? null;
}

export async function saveCachedBrief(
  conversationId: string,
  brief: CachedBrief,
): Promise<void> {
  await chrome.storage.local.set({ [PREFIX + conversationId]: brief });
}
