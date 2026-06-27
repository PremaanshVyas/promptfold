/**
 * Options page (React). BYOK settings with a model picker that explains cost.
 *
 * The key is stored with chrome.storage.local on this machine and is sent only
 * to the provider the user picks (Anthropic or OpenAI). There is no PromptFold
 * account and no server.
 */

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  type Settings,
} from "../shared/settings.js";

type HostedProvider = "anthropic" | "openai";

interface ModelOption {
  id: string;
  label: string;
  cost: string; // $ cheapest .. $$$ priciest
  note: string; // when to use it, by chat type
}

const MODELS: Record<HostedProvider, ModelOption[]> = {
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", cost: "$$$", note: "Most capable and most expensive. Long, complex, or important chats." },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", cost: "$$", note: "Balanced. The right default for most chats." },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", cost: "$", note: "Cheapest and fastest. Short or simple chats." },
    { id: "claude-3-7-sonnet-latest", label: "Claude Sonnet 3.7", cost: "$$", note: "Previous generation, still strong." },
    { id: "claude-3-5-sonnet-latest", label: "Claude Sonnet 3.5", cost: "$$", note: "Older balanced model." },
    { id: "claude-3-5-haiku-latest", label: "Claude Haiku 3.5", cost: "$", note: "Older cheap option." },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o", cost: "$$", note: "Balanced. A solid default for most chats." },
    { id: "gpt-4o-mini", label: "GPT-4o mini", cost: "$", note: "Cheapest. Short or simple chats." },
    { id: "gpt-4.1", label: "GPT-4.1", cost: "$$", note: "Strong general model." },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", cost: "$", note: "Cheap and capable." },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano", cost: "$", note: "Cheapest GPT-4.1." },
    { id: "o4-mini", label: "o4-mini", cost: "$$", note: "Reasoning model for complex chats." },
    { id: "o3-mini", label: "o3-mini", cost: "$$", note: "Older reasoning model." },
  ],
};

const KEY_LINKS: Record<HostedProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

const CUSTOM = "__custom__";

function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [customModel, setCustomModel] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      // Only Anthropic and OpenAI are offered; coerce any legacy value.
      const provider: HostedProvider = s.provider === "openai" ? "openai" : "anthropic";
      const next = { ...s, provider };
      setSettings(next);
      setCustomModel(next.model !== "" && !MODELS[provider].some((m) => m.id === next.model));
      setLoaded(true);
    });
  }, []);

  const provider = settings.provider as HostedProvider;
  const models = MODELS[provider];
  const known = useMemo(
    () => models.find((m) => m.id === settings.model),
    [models, settings.model],
  );

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaved(false);
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function onProvider(value: HostedProvider) {
    setSaved(false);
    setCustomModel(false);
    setSettings((prev) => ({
      ...prev,
      provider: value,
      model: value === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o",
    }));
  }

  function onModelSelect(value: string) {
    setSaved(false);
    if (value === CUSTOM) {
      setCustomModel(true);
      update("model", "");
    } else {
      setCustomModel(false);
      update("model", value);
    }
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
            value={provider}
            onChange={(e) => onProvider(e.target.value as HostedProvider)}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={customModel ? CUSTOM : settings.model}
            onChange={(e) => onModelSelect(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.cost}
              </option>
            ))}
            <option value={CUSTOM}>Custom model id…</option>
          </select>

          {customModel ? (
            <>
              <input
                style={{ marginTop: 10 }}
                value={settings.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="exact model id from your provider"
              />
              <p className="hint">
                Paste any model id your provider accepts. Use this if a model
                above has been renamed or you want one not listed.
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
            placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
          />
          <p className="hint">
            Get a key from{" "}
            <a href={KEY_LINKS[provider]} target="_blank" rel="noreferrer">
              {provider === "anthropic" ? "console.anthropic.com" : "platform.openai.com"}
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
