/**
 * Options page (React). BYOK settings.
 *
 * The key is stored with chrome.storage.local on this machine and is sent only
 * to the provider the user picks. There is no PromptFold account and no server.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_MODELS, type Provider } from "@promptfold/core";
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  type Settings,
} from "../shared/settings.js";

const card: React.CSSProperties = {
  background: "var(--card,#fff)",
  border: "1px solid #e6e3dd",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid #d8d4cc",
  fontSize: 14,
  background: "transparent",
  color: "inherit",
};
const button: React.CSSProperties = {
  background: "#2f7f7a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

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

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaved(false);
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      // When switching provider, suggest its default model if the field is a
      // known default for the other provider.
      if (key === "provider") {
        const wasDefault = Object.values(DEFAULT_MODELS).includes(prev.model);
        if (wasDefault) next.model = DEFAULT_MODELS[value as Provider];
      }
      return next;
    });
  }

  async function onSave() {
    await saveSettings(settings);
    setSaved(true);
  }

  if (!loaded) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>PromptFold settings</h1>
      <p style={{ color: "#7a766d", marginTop: 0 }}>
        Bring your own key. It is stored on this machine and sent only to the
        provider you choose, there is no PromptFold account and no server.
      </p>

      <div style={card}>
        <label style={label} htmlFor="provider">
          Provider
        </label>
        <select
          id="provider"
          style={input}
          value={settings.provider}
          onChange={(e) => update("provider", e.target.value as Provider)}
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
        </select>

        <div style={{ height: 14 }} />
        <label style={label} htmlFor="model">
          Model
        </label>
        <input
          id="model"
          style={input}
          value={settings.model}
          onChange={(e) => update("model", e.target.value)}
          placeholder={DEFAULT_MODELS[settings.provider]}
        />

        <div style={{ height: 14 }} />
        <label style={label} htmlFor="key">
          API key
        </label>
        <input
          id="key"
          type="password"
          autoComplete="off"
          style={input}
          value={settings.apiKey}
          onChange={(e) => update("apiKey", e.target.value)}
          placeholder={settings.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
        />
        <p style={{ fontSize: 12, color: "#7a766d" }}>
          Leave empty to use the free, no-key brief (complete capture + extracted
          exact values + files-to-attach). Add a key for the full structured
          brief with reasoning.
        </p>
      </div>

      <button style={button} onClick={onSave}>
        Save
      </button>
      {saved && (
        <span style={{ marginLeft: 12, color: "#2e7d32", fontSize: 14 }}>
          Saved ✓
        </span>
      )}

      <p style={{ fontSize: 12, color: "#9a958b", marginTop: 24 }}>
        Privacy: your chat is read locally in your browser and sent only to your
        chosen AI provider with your key. PromptFold has no middleman server.
      </p>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Options />);
