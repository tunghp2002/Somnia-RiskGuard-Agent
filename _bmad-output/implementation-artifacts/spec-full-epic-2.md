---
title: 'Full Epic 2: Portfolio Monitoring & AI Risk Engine'
type: 'feature'
created: '2026-05-13'
status: 'done'
baseline_commit: '7437be7bf812b57a156903cc31e3b81eda940b9e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1 can register a monitored wallet and persist/audit setup state, but the agent cannot yet read portfolio state, detect risk-relevant changes, generate advisory Risk Scores, or persist risk results for dashboard/Telegram consumers.

**Approach:** Implement Epic 2 as one backend slice: portfolio snapshot collection through a read-only Somnia/demo boundary, deterministic change detection, Groq-primary/DeepSeek-fallback risk scoring, non-advisory explanation sanitization, and JSON persistence/API surfaces for portfolio and risk state.

## Boundaries & Constraints

**Always:** Keep all new behavior inside `/agent`; use zod at API/provider/persistence boundaries; keep Somnia reads read-only; persist under `agent/src/persistence/data`; checksum-normalize wallet addresses; record audit events for snapshots, skipped analysis, LLM fallback, and threshold decisions; return API responses as `{ data, meta }` or `{ error }`; keep LLM output informational and non-executable.

**Ask First:** If real Somnia portfolio data requires an uninstalled SDK/package or a non-read-only chain operation, halt and ask before adding dependencies or changing execution policy. If provider response formats require live API probing, mock and validate deterministic provider boundaries instead of calling real secrets.

**Never:** Do not implement Telegram delivery, dashboard UI, contract logic, reward claiming, arbitrary transfers, autonomous trading, portfolio rebalancing, or LLM-authorized transactions in this epic.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Monitor configured wallet | At least one user exists in `users.json` | Latest portfolio snapshot is stored and audited | If Somnia/RPC read fails, record subsystem error and fail closed |
| No monitored wallet | Empty users repository | Monitor skips portfolio read and records safe audit event | No LLM call |
| Meaningful change | New snapshot differs from prior balance/reward/risk signals | Change result marks `shouldAnalyzeRisk: true` | Persist comparison metadata |
| No meaningful change | Snapshot matches prior meaningful fields | Risk analysis is skipped | Audit `risk.analysis.skipped` |
| Groq succeeds | Portfolio context ready | Risk score `0-100`, provider `groq`, explanation, threshold result persisted | Invalid provider shape fails validation |
| Groq fails, DeepSeek succeeds | Primary throws/times out | Fallback risk score persisted with provider `deepseek` and fallback audit event | If fallback fails, persist/audit safe failure |
| Unsafe LLM wording | Explanation recommends trading/transfers | Output is reframed as informational and executable actions are empty | Unsafe recommendations are not persisted as actions |

</frozen-after-approval>

## Code Map

- `agent/src/persistence/users.repository.ts` -- Source of configured monitored wallets from Epic 1.
- `agent/src/persistence/risk-snapshots.repository.ts` -- Existing risk snapshot stub; needs Epic 2 fields and append helpers.
- `agent/src/persistence/json-store.ts` -- Shared JSON persistence with serialized writes.
- `agent/src/services/audit.service.ts` -- Audit entry point for monitoring, fallback, skip, and threshold events.
- `agent/src/integrations/somnia/somnia-agent-kit.client.ts` -- Read-only Somnia tool boundary for portfolio reads.
- `agent/src/api/server.ts` -- Existing local/demo REST API to extend with portfolio/risk reads.
- `agent/src/config/env.ts` -- Risk threshold and provider config already validated.
- `agent/src/integrations/llm/` -- Empty Epic 2 home for Groq, DeepSeek, and prompt/response schemas.
- `agent/src/services/` -- Home for `portfolio.service.ts` and `risk-score.service.ts`.
- `agent/src/jobs/` -- Home for `portfolio-monitor.job.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `agent/src/persistence/portfolio-snapshots.repository.ts` -- add zod-validated portfolio snapshot persistence with wallet, balances, rewards, risk signals, source, and timestamp.
- [x] `agent/src/persistence/risk-snapshots.repository.ts` -- extend schema and repository helpers for provider, threshold result, safe next steps, and append/latest queries.
- [x] `agent/src/services/portfolio.service.ts` -- collect demo or read-only Somnia portfolio snapshots for configured users and detect balance/reward/risk-signal changes.
- [x] `agent/src/jobs/portfolio-monitor.job.ts` -- expose a monitor runner that calls portfolio service, skips safely with audit when no analysis is needed, and triggers risk scoring when needed.
- [x] `agent/src/integrations/llm/risk-prompt.ts` -- build bounded portfolio-risk prompts that forbid financial advice and executable recommendations.
- [x] `agent/src/integrations/llm/groq.client.ts` and `agent/src/integrations/llm/deepseek.client.ts` -- add fetch-based provider clients with timeout, response validation, and secret-safe errors.
- [x] `agent/src/services/risk-score.service.ts` -- orchestrate Groq primary, DeepSeek fallback, score validation, advisory-boundary filtering, threshold evaluation, audit events, and persistence.
- [x] `agent/src/api/server.ts` -- add read routes for latest portfolio and risk state using existing response wrappers.
- [x] `agent/src/index.ts` -- export Epic 2 services, repositories, schemas, and job runner for tests/scripts.
- [x] `agent/src/**/*.test.ts` -- cover the I/O matrix: monitoring, no-wallet skip, change detection, provider fallback, unsafe wording filtering, threshold persistence, and API state reads.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` and Epic 2 story artifacts -- mark Epic 2 stories implemented/reviewable or done after verification, preserving existing sprint format.

**Acceptance Criteria:**
- Given a configured monitored wallet, when the monitor runs, then a latest portfolio snapshot is persisted and audited.
- Given no meaningful portfolio change, when monitoring completes, then risk analysis is skipped and a safe audit event is recorded.
- Given Groq fails and DeepSeek succeeds, when risk analysis runs, then the fallback score is persisted and fallback is audited.
- Given generated risk text contains advice-like or action-like wording, when it is processed, then persisted output remains informational and contains no executable action authorization.
- Given a score is generated, when it is persisted, then wallet, score, explanation, provider, threshold result, safe next steps, and timestamp are available through repository/API reads.

## Spec Change Log

## Design Notes

Use explicit demo fixtures as the default deterministic path for tests and local demos. Real Somnia reads should be isolated behind `SomniaAgentKitClient.callTool({ toolName: "getPortfolio", stateChanging: false })` so replacing demo data with SDK data later does not alter risk scoring or persistence contracts.

## Verification

**Commands:**
- `pnpm --dir agent lint` -- expected: TypeScript passes with strict settings.
- `pnpm --dir agent build` -- expected: agent compiles.
- `pnpm --dir agent test` -- expected: all existing and Epic 2 tests pass.

## Suggested Review Order

**Portfolio Monitoring**

- Start here to understand the monitor flow and demo/Somnia read boundary.
  [`portfolio.service.ts:30`](../../agent/src/services/portfolio.service.ts#L30)

- Review how meaningful changes decide whether AI analysis should run.
  [`portfolio.service.ts:92`](../../agent/src/services/portfolio.service.ts#L92)

- Check the persisted portfolio data contract.
  [`portfolio-snapshots.repository.ts:25`](../../agent/src/persistence/portfolio-snapshots.repository.ts#L25)

- Confirm job orchestration only analyzes changed snapshots.
  [`portfolio-monitor.job.ts:15`](../../agent/src/jobs/portfolio-monitor.job.ts#L15)

**Risk Scoring**

- Review primary/fallback provider orchestration and persistence.
  [`risk-score.service.ts:27`](../../agent/src/services/risk-score.service.ts#L27)

- Check advisory filtering and executable-action exclusion.
  [`risk-score.service.ts:82`](../../agent/src/services/risk-score.service.ts#L82)

- Review provider request/response boundary and timeout behavior.
  [`groq.client.ts:35`](../../agent/src/integrations/llm/groq.client.ts#L35)

- Confirm prompt constraints prohibit financial advice.
  [`risk-prompt.ts:8`](../../agent/src/integrations/llm/risk-prompt.ts#L8)

**Persistence And API**

- Check risk snapshot fields used by dashboard/Telegram later.
  [`risk-snapshots.repository.ts:7`](../../agent/src/persistence/risk-snapshots.repository.ts#L7)

- Review latest portfolio and risk API routes.
  [`server.ts:91`](../../agent/src/api/server.ts#L91)

- Confirm API tests cover latest-state reads and query validation.
  [`server.test.ts:131`](../../agent/src/api/server.test.ts#L131)

**Verification**

- Review fallback, threshold, and advisory-boundary tests.
  [`risk-score.service.test.ts:55`](../../agent/src/services/risk-score.service.test.ts#L55)
