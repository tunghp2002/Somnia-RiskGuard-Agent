# Epic 2 Context: Portfolio Monitoring & AI Risk Engine

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 2 gives the agent its core risk-monitoring capability: read a configured Somnia wallet portfolio, detect meaningful state changes, generate an AI Risk Score through Groq with DeepSeek fallback, keep explanations informational rather than advisory, and persist current/recent risk state for later dashboard and Telegram flows. This epic depends on Epic 1 foundations: validated runtime config, separated user/agent wallets, JSON repositories, audit events, setup API, and Somnia integration boundaries.

## Stories

- Story 2.1: Monitor Portfolio State For Configured Wallets
- Story 2.2: Detect Portfolio And Risk Signal Changes
- Story 2.3: Generate AI Risk Score With Groq And DeepSeek Fallback
- Story 2.4: Enforce Advisory Risk Explanation Boundaries
- Story 2.5: Persist Risk Snapshots And Threshold Results

## Requirements & Constraints

- Users can configure a risk alert threshold and the agent must evaluate generated scores against that threshold.
- The agent must monitor configured wallet portfolio state on Somnia Testnet, or use explicit demo fixtures when real chain data is unavailable or demo mode is selected.
- Monitoring must fail closed when chain configuration, RPC access, or integration health is invalid.
- The agent must detect balance, reward, and configured risk-signal changes and decide whether risk analysis should run.
- No meaningful portfolio change should skip AI analysis and record a safe audit event.
- Risk Score generation must return an integer score from 0 to 100 with provider, explanation, threshold result, and ISO timestamp.
- Groq is the primary LLM provider. DeepSeek is the fallback when Groq fails or times out, and fallback use must be visible in logs/audit history.
- Risk explanations must be readable, informational, and non-advisory. They must not instruct the user to buy, sell, trade, transfer arbitrarily, or authorize execution.
- LLM output is advisory only and cannot authorize transactions or bypass deterministic policy gates.
- Failed provider, RPC, LLM, and persistence flows must produce actionable diagnostics without exposing secrets.

## Technical Decisions

- Keep code under `/agent`; services own business behavior, jobs call services, repositories own JSON persistence, and integrations isolate external providers.
- Use `zod` at input, provider response, and persistence boundaries.
- Use `pino` structured logs and the existing audit service/repository for risk analysis, skipped analysis, provider fallback, and threshold decisions.
- JSON data stays under `agent/src/persistence/data` and is accessed only through repository helpers.
- API responses use `{ data, meta }` and `{ error }`; dates are ISO 8601 strings and on-chain/bigint values are serialized as decimal strings.
- Wallet addresses are checksum-normalized before persistence.
- Somnia interactions should remain behind `agent/src/integrations/somnia/`; state-changing tool calls require policy decisions, but Epic 2 monitoring/risk reads should stay read-only.
- Preferred structure for this epic: `agent/src/services/portfolio.service.ts`, `agent/src/services/risk-score.service.ts`, `agent/src/jobs/portfolio-monitor.job.ts`, `agent/src/integrations/llm/groq.client.ts`, `agent/src/integrations/llm/deepseek.client.ts`, and `agent/src/integrations/llm/risk-prompt.ts`.
- Tests should be co-located and cover monitoring snapshots, change detection, LLM fallback, advisory-boundary filtering, threshold persistence, and audit records.

## UX & Interaction Patterns

- Risk explanations should be understandable without raw on-chain inspection.
- Output must clearly frame risk scoring as informational analysis, not financial advice.
- Persisted state should support future dashboard and Telegram views showing current portfolio status, current Risk Score, recent explanations, and subsystem/provider health.

## Cross-Story Dependencies

- Story 2.1 creates portfolio snapshots used by change detection.
- Story 2.2 decides whether Story 2.3 risk analysis should run.
- Story 2.3 depends on LLM provider clients and writes candidate risk results.
- Story 2.4 sanitizes/limits risk explanation output before persistence or display.
- Story 2.5 finalizes persistence for dashboard and Telegram consumers.
