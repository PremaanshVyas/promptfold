/**
 * Typed wrapper over chrome.storage.local for BYOK settings.
 *
 * The API key lives here, on the user's machine, and is read ONLY by the
 * service worker when making the LLM call. It is never logged, never sent to
 * any PromptFold server (there is none), and never injected into the page.
 */

import type { Provider } from "@promptfold/core";

export interface Settings {
  provider: Provider;
  apiKey: string;
  model: string;
  /** OpenAI-compatible base URL for the "custom" provider. */
  baseUrl: string;
}

const KEY = "promptfold.settings";

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  apiKey: "",
  model: "claude-sonnet-4-6",
  baseUrl: "",
};

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  const raw = got[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

/** True when the distiller is configured (a key, or a custom endpoint URL). */
export function hasKey(settings: Settings): boolean {
  if (settings.provider === "custom") return settings.baseUrl.trim().length > 0;
  return settings.apiKey.trim().length > 0;
}
