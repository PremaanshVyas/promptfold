/**
 * Options page (React). BYOK settings with a model picker that explains cost,
 * plus an "Other (OpenAI-compatible)" provider for any endpoint (Groq, Gemini,
 * OpenRouter, a local Ollama, etc.).
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
  cost: string; // $ cheapest .. $$$ priciest
  note: string; // when to use it, by chat type
}

const MODELS: Record<"anthropic" | "openai", ModelOption[]> = {
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

const KEY_LINKS: Record<"anthropic" | "openai", string> = {
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
      setSettings(s);
      if (s.provider === "anthropic" || s.provider === "openai") {
        setCustomModel(
          s.model !== "" && !MODELS[s.provider].some((m) => m.id === s.model),
        );
      }
      setLoaded(true);
    });
  }, []);

  const hosted = settings.provider === "anthropic" || settings.provider === "openai";
  const hostedKey = settings.provider as "anthropic" | "openai";
  const models: ModelOption[] = hosted ? MODELS[hostedKey] : [];
  const known = useMemo(
    () => models.find((m) => m.id === settings.model),
    [models, settings.model],
  );

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaved(false);
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function onProvider(value: Provider) {
    setSaved(false);
    setCustomModel(false);
    setSettings((prev) => {
      const next = { ...prev, provider: value };
      if (value === "anthropic") next.model = "claude-sonnet-4-6";
      else if (value === "openai") next.model = "gpt-4o";
      else next.model = ""; // custom: free-text model id
      return next;
    });
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
    if (settings.provider === "custom") {
      if (!settings.baseUrl.trim()) {
        alert("Enter the OpenAI-compatible base URL for your endpoint.");
        return;
      }
      let origin: string;
      try {
        origin = new URL(settings.baseUrl).origin + "/*";
      } catch {
        alert("That base URL is not valid.");
        return;
      }
      // The worker needs permission to call an arbitrary endpoint; request it now.
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        alert("PromptFold needs permission to call that endpoint to use it.");
        return;
      }
    }
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
            onChange={(e) => onProvider(e.target.value as Provider)}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
            <option value="custom">Other (OpenAI-compatible endpoint)</option>
          </select>
        </div>

        {hosted ? (
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
        ) : (
          <>
            <div className="field">
              <label htmlFor="baseurl">Base URL (OpenAI-compatible)</label>
              <input
                id="baseurl"
                value={settings.baseUrl}
                onChange={(e) => update("baseUrl", e.target.value)}
                placeholder="https://api.groq.com/openai/v1"
              />
              <p className="hint">
                Any endpoint that speaks the OpenAI chat-completions format.
                Examples: Groq <code>https://api.groq.com/openai/v1</code>,
                OpenRouter <code>https://openrouter.ai/api/v1</code>, Gemini{" "}
                <code>https://generativelanguage.googleapis.com/v1beta/openai</code>,
                local Ollama <code>http://localhost:11434/v1</code> (no key needed).
              </p>
            </div>
            <div className="field">
              <label htmlFor="custommodel">Model id</label>
              <input
                id="custommodel"
                value={settings.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="e.g. llama-3.3-70b-versatile"
              />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="key">
            API key{settings.provider === "custom" ? " (leave empty for local Ollama)" : ""}
          </label>
          <input
            id="key"
            type="password"
            autoComplete="off"
            value={settings.apiKey}
            onChange={(e) => update("apiKey", e.target.value)}
            placeholder={settings.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
          />
          {hosted && (
            <p className="hint">
              Get a key from{" "}
              <a href={KEY_LINKS[hostedKey]} target="_blank" rel="noreferrer">
                {settings.provider === "anthropic"
                  ? "console.anthropic.com"
                  : "platform.openai.com"}
              </a>
              . Leave empty to use the free, no-key brief (complete capture +
              extracted exact values + files-to-attach). Add a key for the full
              structured brief with reasoning.
            </p>
          )}
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
