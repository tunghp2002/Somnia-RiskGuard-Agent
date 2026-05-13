---
title: 'Full Epic 3: Telegram Alerts & Authenticated Quick Actions'
type: 'feature'
created: '2026-05-13'
status: 'done'
baseline_commit: 'fc58b644cb896f23f8558dff63cd264eba617222'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 2 can monitor portfolios and produce risk snapshots, but users still cannot receive Telegram alerts or respond through authenticated quick actions. Without this epic, the demo lacks the agentic loop from risk detection to user action.

**Approach:** Add a Telegram binding, alert delivery, signed callback, nonce, acknowledgment, refresh-analysis, and policy-routing layer that integrates with the existing setup, risk, audit, repository, and API patterns. Keep execution safety deterministic: callbacks can request supported workflows, but unsupported or unsafe actions fail closed.

## Boundaries & Constraints

**Always:** Use zod at external boundaries, persist Telegram/action state only through repository helpers, checksum-normalize wallet addresses where wallet input appears, keep secrets out of persisted state and audit metadata, record audit events for send/callback/policy outcomes, and preserve existing API response shape. Callback payloads must include action type, user ID, nonce, expiry, and signature; expired/replayed/malformed/unsigned/wrong-user callbacks must be rejected before side effects.

**Ask First:** Adding real Telegram Bot API network dependencies beyond a small injectable client boundary; signing or submitting real on-chain transactions; changing existing risk scoring semantics; broadening supported quick actions beyond acknowledge, refresh-analysis, and policy-routed safe-action approval.

**Never:** Do not let LLM output authorize a transaction, do not implement arbitrary transfer/trade/swap/rebalance actions, do not store bot tokens/private keys/signatures in JSON persistence, do not silently drop Telegram failures, and do not start alert sends when Telegram config or chat binding is unavailable.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link chat | Valid user/wallet plus Telegram chat ID | Binding is persisted and readiness/health can show Telegram configured | Invalid IDs or missing bot config return validation/health failure |
| Threshold alert | Risk snapshot has `threshold.exceeded=true` and binding exists | Alert message includes score, severity, explanation, and signed quick-action buttons | Telegram send failure records audit/log and does not retry unsafe actions |
| Invalid callback | Expired, malformed, unsigned, wrong-chat, or replayed payload | Reject before side effects and record denial | Return safe user-facing rejection reason |
| Acknowledge | Valid acknowledge callback for an open alert | Alert is marked acknowledged and confirmation is sent | Missing alert/binding fails closed with audit event |
| Refresh analysis | Valid refresh callback and latest portfolio exists | New risk analysis runs and refreshed result is sent to Telegram | Missing portfolio or provider failure is reported without unsafe execution |
| Safe approval | Valid approval callback for supported safe action | Request is routed through policy gate and denial prevents signing | Unsupported action is rejected as outside MVP scope |

</frozen-after-approval>

## Code Map

- `agent/src/config/env.ts` -- Telegram env parsing and enabled-state source.
- `agent/src/api/server.ts` -- REST setup/readiness surface and route pattern for Telegram binding/test endpoints if needed.
- `agent/src/persistence/action-nonces.repository.ts` -- Existing nonce record foundation; needs create/consume behavior.
- `agent/src/persistence/audit-events.repository.ts` -- Secret-safe audit trail for send/callback/policy outcomes.
- `agent/src/policies/execution-policy.ts` -- Existing deterministic policy decision shape; needs supported Telegram approval routing.
- `agent/src/services/risk-score.service.ts` -- Refresh-analysis target for valid callbacks.
- `agent/src/jobs/portfolio-monitor.job.ts` -- Risk threshold detection point where alert dispatch can be integrated.
- `agent/src/integrations/telegram/` -- New injectable Telegram client, callback signing, alert formatting, and action processing boundary.

## Tasks & Acceptance

**Execution:**
- [x] `agent/src/persistence/telegram-bindings.repository.ts` -- add Telegram chat binding records with user/wallet linkage and validation.
- [x] `agent/src/persistence/alerts.repository.ts` -- add alert records with sent/failed/acknowledged state and risk snapshot linkage.
- [x] `agent/src/persistence/action-nonces.repository.ts` -- add nonce creation and consume-once APIs for callback replay protection.
- [x] `agent/src/integrations/telegram/callback-signing.ts` -- sign and verify compact callback payloads with TTL, nonce, user, chat, and action validation.
- [x] `agent/src/integrations/telegram/telegram.client.ts` -- add injectable Telegram delivery interface and health behavior that fails closed when disabled.
- [x] `agent/src/services/telegram-alert.service.ts` -- send threshold alerts, format quick actions, record alert/audit outcomes, and expose acknowledge/refresh/approval handlers.
- [x] `agent/src/policies/execution-policy.ts` -- add explicit supported/unsupported Telegram approval policy helper.
- [x] `agent/src/jobs/portfolio-monitor.job.ts` -- optionally notify Telegram after risk analysis creates a threshold-exceeded snapshot.
- [x] `agent/src/api/server.ts` -- expose Telegram binding, health/test, and callback routes following existing response/error conventions.
- [x] `agent/src/index.ts` -- export new repositories, service, client, callback, and policy primitives.
- [x] `agent/src/**/*.test.ts` -- cover binding, health fail-closed behavior, alert formatting/send failure audit, callback signature/expiry/replay rejection, acknowledge, refresh, and policy denial.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` and Epic 3 story files -- mark Epic 3 progress consistently when implementation is complete.

**Acceptance Criteria:**
- Given a Telegram chat is linked to a monitored wallet, when settings are saved, then the agent persists the binding and validates required bot configuration.
- Given Telegram config is missing or invalid, when setup or alert delivery runs, then Telegram health reports failure and alerts are not attempted.
- Given a risk threshold is crossed, when alert delivery runs, then the Telegram message includes Risk Score, explanation, severity, and signed quick-action buttons.
- Given a callback is expired, replayed, malformed, unsigned, or unauthorized, when it is processed, then it is rejected and recorded without side effects.
- Given a valid acknowledge callback, when it is processed, then the alert is marked acknowledged and confirmation is sent.
- Given a valid refresh-analysis callback, when it is processed, then a new risk analysis is requested and the refreshed result is sent back.
- Given a supported safe-action approval callback, when it is processed, then deterministic policy gates run before execution and denial prevents signing.
- Given an unsupported action, when it is processed, then the agent rejects it and explains that it is outside MVP scope.

## Spec Change Log

## Design Notes

Use dependency injection for Telegram transport so tests do not require network access. Treat callback handling as a service-level boundary: route handlers or polling adapters pass Telegram user/chat and callback data in, and the service returns a safe confirmation/rejection message. Persist alert state separately from risk snapshots so acknowledge status does not mutate historical risk analysis.

Telegram callback data uses a compact signed nonce to stay inside Telegram callback size limits. The nonce record stores the action type, user ID, chat ID, expiry, and action-specific fields, so validation still checks the full required context before any side effect.

## Verification

**Commands:**
- `pnpm --dir agent lint` -- expected: TypeScript passes without emit.
- `pnpm --dir agent build` -- expected: agent compiles successfully.
- `pnpm --dir agent test` -- expected: all Vitest tests pass, including new Telegram callback and alert tests.

## Suggested Review Order

**Telegram Action Boundary**

- Start here for the binding, alerting, and callback orchestration.
  [`telegram-alert.service.ts:89`](../../agent/src/services/telegram-alert.service.ts#L89)

- Threshold alerts create message text, buttons, alert records, and audit events.
  [`telegram-alert.service.ts:159`](../../agent/src/services/telegram-alert.service.ts#L159)

- Callback handling validates signed nonce, binding, replay, then routes actions.
  [`telegram-alert.service.ts:263`](../../agent/src/services/telegram-alert.service.ts#L263)

**Replay And Payload Safety**

- Compact callback data keeps Telegram buttons within size limits.
  [`callback-signing.ts:101`](../../agent/src/integrations/telegram/callback-signing.ts#L101)

- Nonce records carry action context and are consumed once.
  [`action-nonces.repository.ts:57`](../../agent/src/persistence/action-nonces.repository.ts#L57)

- Replay and expiry protection live in the atomic update path.
  [`action-nonces.repository.ts:78`](../../agent/src/persistence/action-nonces.repository.ts#L78)

**Persistence And Policy**

- Telegram bindings connect user, wallet, chat, and optional Telegram user.
  [`telegram-bindings.repository.ts:32`](../../agent/src/persistence/telegram-bindings.repository.ts#L32)

- Alert records preserve sent, failed, and acknowledged state.
  [`alerts.repository.ts:52`](../../agent/src/persistence/alerts.repository.ts#L52)

- Safe-action approvals route through deterministic policy decisions.
  [`execution-policy.ts:53`](../../agent/src/policies/execution-policy.ts#L53)

**Runtime Entry Points**

- REST routes expose health, binding, callback, and test-alert surfaces.
  [`server.ts:137`](../../agent/src/api/server.ts#L137)

- Portfolio monitoring dispatches Telegram alerts after risk analysis.
  [`portfolio-monitor.job.ts:24`](../../agent/src/jobs/portfolio-monitor.job.ts#L24)

**Verification**

- Service tests cover send failures, replay, expiry, refresh, and policy denial.
  [`telegram-alert.service.test.ts:135`](../../agent/src/services/telegram-alert.service.test.ts#L135)

- API tests cover Telegram health, binding, and test-alert routes.
  [`server.test.ts:249`](../../agent/src/api/server.test.ts#L249)
