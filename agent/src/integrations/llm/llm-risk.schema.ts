import { z } from "zod";

export const llmRiskResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  explanation: z.string().min(1),
  safeNextSteps: z.array(z.string()).default([])
});

export type LlmRiskResult = z.infer<typeof llmRiskResultSchema>;

export type RiskProviderName = "groq" | "deepseek";

export interface RiskProvider {
  readonly provider: RiskProviderName;
  analyze(prompt: { system: string; user: string }): Promise<LlmRiskResult>;
}

export class RiskProviderError extends Error {
  public constructor(
    message: string,
    public readonly provider: RiskProviderName,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "RiskProviderError";
  }
}

export function parseRiskProviderContent(content: string): LlmRiskResult {
  return llmRiskResultSchema.parse(JSON.parse(content));
}
