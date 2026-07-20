import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from "./types.js";

export type OllamaOptions = {
  host?: string;
  model?: string;
};

export class OllamaProvider implements LlmProvider {
  readonly id = "ollama" as const;
  private host: string;
  private model: string;

  constructor(opts: OllamaOptions = {}) {
    this.host = (opts.host ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(
      /\/$/,
      "",
    );
    this.model = opts.model ?? process.env.OLLAMA_MODEL ?? "llama3";
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
    return this.chat({
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      jsonMode: req.jsonMode,
      temperature: 0.4,
    });
  }

  /** Multi-turn chat (used by companion side panel). */
  async chat(opts: {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    jsonMode?: boolean;
    temperature?: number;
  }): Promise<LlmCompleteResult> {
    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: opts.jsonMode ? "json" : undefined,
        messages: [{ role: "system", content: opts.system }, ...opts.messages],
        options: {
          temperature: opts.temperature ?? 0.5,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama chat failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      message?: { content?: string };
    };
    const text = data.message?.content?.trim() ?? "";
    if (!text) throw new Error("Ollama returned empty content");
    return { text, provider: "ollama", model: this.model };
  }

  get modelName(): string {
    return this.model;
  }
}
