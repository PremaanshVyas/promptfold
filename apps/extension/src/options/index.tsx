/**
 * Options page (React). BYOK settings with a model picker that explains cost.
 *
 * The key is stored with chrome.storage.local on this machine and is sent only
 * to the provider the user picks. There is no PromptFold account and no server.
 */

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Provider } from "@promptfold/core";
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  type Settings,
} from "../shared/settings.js";

interface ModelOption {
  id: string;
  label: string;
  /** Relative cost, $ cheapest to $$$ priciest. */
  cost: string;
  /** When to use it, by chat type. */
  note: string;
}

const MODELS: Record<Provider, ModelOption[]> = {
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", cost: "$", note: "Cheapest and fastest. Best for short or simple chats." },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", cost: "$$", note: "Balanced. The right default for most chats." },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", cost: "$$$", note: "Most capable and most expensive. Use for long, complex, or important chats." },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini", cost: "$", note: "Cheapest. Best for short or simple chats." },
    { id: "gpt-4o", label: "GPT-4o", cost: "$$", note: "Balanced. A solid default for most chats." },
  ],
};

const KEY_LINKS: Record<Provider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

const CUSTOM = "__custom__";

function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  const models = MODELS[settings.provider];
  const known = useMemo(
    () => models.find((m) => m.id === settings.model),
    [models, settings.model],
  );
  const isCustom = settings.model.length > 0 && !known;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaved(false);
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "provider") {
        const list = MODELS[value as Provider];
        next.model = list[1]?.id ?? list[0]?.id ?? "";
      }
      return next;
    });
  }

  function onModelSelect(value: string) {
    update("model", value === CUSTOM ? "" : value);
  }

  async function onSave() {
    await saveSettings(settings);
    setSaved(true);
  }

  if (!loaded) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div>
      <h1>PromptFold settings</h1>
      <p className="sub">
        Bring your own key. It is stored on this machine and sent only to the
        provider you choose. There is no PromptFold account and no server.
      </p>

      <div className="card">
        <div className="field">
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={settings.provider}
            onChange={(e) => update("provider", e.target.value as Provider)}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={isCustom ? CUSTOM : settings.model}
            onChange={(e) => onModelSelect(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.cost}
              </option>
            ))}
            <option value={CUSTOM}>Custom model id…</option>
          </select>

          {isCustom ? (
            <>
              <input
                style={{ marginTop: 10 }}
                value={settings.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="exact model id (e.g. claude-3-5-haiku-latest)"
              />
              <p className="hint">
                Type any model id your provider accepts. Use this if a model
                above has been renamed.
              </p>
            </>
          ) : (
            known && (
              <div className="cost">
                <span className="dollars">{known.cost}</span>
                <span>
                  {known.note} (More capable models cost more per chat; longer
                  chats cost more on any model.)
                </span>
              </div>
            )
          )}
        </div>

        <div className="field">
          <label htmlFor="key">API key</label>
          <input
            id="key"
            type="password"
            autoComplete="off"
            value={settings.apiKey}
            onChange={(e) => update("apiKey", e.target.value)}
            placeholder={settings.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
          />
          <p className="hint">
            Get a key from{" "}
            <a href={KEY_LINKS[settings.provider]} target="_blank" rel="noreferrer">
              {settings.provider === "anthropic"
                ? "console.anthropic.com"
                : "platform.openai.com"}
            </a>
            . Leave empty to use the free, no-key brief (complete capture +
            extracted exact values + files-to-attach). Add a key for the full
            structured brief with reasoning.
          </p>
        </div>
      </div>

      <div className="row">
        <button className="btn" onClick={onSave}>
          Save
        </button>
        {saved && <span className="saved">Saved ✓</span>}
      </div>

      <p className="foot">
        Privacy: your chat is read locally in your browser and sent only to your
        chosen AI provider with your key. PromptFold has no middleman server.
      </p>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Options />);
