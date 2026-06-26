/**
 * BYOK LLM client — provider-agnostic interface plus Anthropic and OpenAI
 * adapters. The key lives on the user's machine and is sent ONLY to the
 * provider the user chose. carrybot never proxies it.
 *
 * The interface is tiny on purpose so the orchestrator can be unit-tested with
 * a fake client (no network, no key).
 */

export interface LlmRequest {
  system: string;
  user: string;
  /** Ask the provider for strict JSON output. */
  json?: boolean;
}

export interface LlmClient {
  readonly id: string;
  complete(req: LlmRequest): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type Provider = "anthropic" | "openai";

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
};

/**
 * Output cap. The merge can emit many items across a long chat; 4096 truncated
 * it mid-array and broke the JSON. 8192 gives headroom, and the parser salvages
 * the complete items if a giant chat ever still overruns.
 */
const MAX_OUTPUT_TOKENS = 8192;

interface HttpResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}
type HttpFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpResponse>;

/** Anthropic Messages API adapter. */
class AnthropicClient implements LlmClient {
  readonly id: string;
  constructor(
    private readonly cfg: LlmConfig,
    private readonly http: HttpFetch,
  ) {
    this.id = `anthropic:${cfg.model}`;
  }

  async complete(req: LlmRequest): Promise<string> {
    const res = await this.http("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": "2023-06-01",
        // Required for calling the API directly from a browser/extension.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
    });
    if (!res.ok) {
      throw new LlmError(
        `Anthropic API error ${res.status}: ${await safeText(res)}`,
        res.status,
      );
    }
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    if (!text) throw new LlmError("Anthropic returned no text content.");
    return text;
  }
}

/** OpenAI Chat Completions adapter. */
class OpenAiClient implements LlmClient {
  readonly id: string;
  constructor(
    private readonly cfg: LlmConfig,
    private readonly http: HttpFetch,
  ) {
    this.id = `openai:${cfg.model}`;
  }

  async complete(req: LlmRequest): Promise<string> {
    const res = await this.http("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      throw new LlmError(
        `OpenAI API error ${res.status}: ${await safeText(res)}`,
        res.status,
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new LlmError("OpenAI returned no content.");
    return text;
  }
}

async function safeText(res: HttpResponse): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 300);
  } catch {
    return "(no body)";
  }
}

/**
 * Default HTTP transport. `fetch` MUST be bound to the global scope — when it is
 * stored as a property and later called as `this.http(...)`, an unbound fetch
 * runs with the wrong receiver and the browser throws
 * "Illegal invocation" (seen for real in the service worker). `.bind` fixes it.
 */
function defaultHttp(): HttpFetch {
  return globalThis.fetch.bind(globalThis) as unknown as HttpFetch;
}

/** Build a client for the configured provider. `http` is injectable for tests. */
export function makeLlmClient(
  cfg: LlmConfig,
  http: HttpFetch = defaultHttp(),
): LlmClient {
  if (!cfg.apiKey) throw new LlmError("Missing API key.");
  switch (cfg.provider) {
    case "anthropic":
      return new AnthropicClient(cfg, http);
    case "openai":
      return new OpenAiClient(cfg, http);
    default:
      throw new LlmError(`Unknown provider: ${cfg.provider as string}`);
  }
}
