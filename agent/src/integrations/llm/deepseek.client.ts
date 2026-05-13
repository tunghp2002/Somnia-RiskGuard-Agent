import type { AgentConfig } from "../../config/env.js";
import {
  parseRiskProviderContent,
  RiskProviderError,
  type LlmRiskResult,
  type RiskProvider
} from "./llm-risk.schema.js";
import type { LlmClientOptions } from "./groq.client.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class DeepSeekClient implements RiskProvider {
  public readonly provider = "deepseek" as const;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(
    private readonly config: AgentConfig,
    options: LlmClientOptions = {}
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  public async analyze(prompt: { system: string; user: string }): Promise<LlmRiskResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher("https://api.deepseek.com/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.config.llm.deepSeek.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.llm.deepSeek.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`DeepSeek request failed with status ${response.status}`);
      }

      const body = (await response.json()) as ChatCompletionResponse;
      const content = body.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("DeepSeek response did not include message content");
      }

      return parseRiskProviderContent(content);
    } catch (error) {
      throw new RiskProviderError("DeepSeek risk analysis failed", this.provider, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
