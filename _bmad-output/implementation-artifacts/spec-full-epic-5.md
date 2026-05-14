---
title: 'Full Epic 5: Safe Reward Claim Automation'
type: 'feature'
created: '2026-05-14'
status: 'done'
baseline_commit: '590b23d7897d2bf499a466bdcc71218dfd42478b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The agent can monitor risk, send Telegram actions, and enforce heartbeat protection, but it cannot yet demonstrate safe routine on-chain autonomy through constrained reward claiming. Without Epic 5, the MVP misses the reward-claim loop required by the product narrative.

**Approach:** Implement reward claim automation as a policy-gated agent slice: persisted reward settings and fixtures, deterministic detection, value/gas policy evaluation, execution through the Somnia boundary only after approval, outcome recording, Telegram reporting, and explicit denial for unsupported autonomous actions.

## Boundaries & Constraints

**Always:** Validate API and persistence inputs with zod; checksum-normalize wallet addresses; keep reward settings explicit per monitored wallet; record audit events for detection, skips, policy denials, attempts, failures, successes, and notifications; require the reward policy to pass immediately before any state-changing Somnia call; preserve existing `{ data, meta }` / `{ error }` API conventions; keep execution behind the dedicated agent wallet boundary.

**Ask First:** Adding a real protocol-specific staking/LP ABI, submitting live testnet transactions beyond the configured Somnia adapter boundary, adding frontend screens, changing Telegram callback signing semantics, or expanding reward execution into swaps, transfers, rebalancing, liquidation, or portfolio management.

**Never:** Do not store private keys or secrets in JSON; do not sign if auto-claim is disabled, thresholds fail, reward data is unavailable, policy is stale/mismatched, or the action type is unsupported; do not retry failed transactions by bypassing policy; do not implement arbitrary transfer or trading actions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Configure rewards | Registered wallet, auto-claim flag, minimum reward USD, maximum gas USD | Settings persist and status exposes configured limits | Invalid wallet or negative thresholds return validation failure |
| Detect fixtures | Reward monitoring enabled with demo fixture rewards | Job/service returns claimable rewards and records detection audit | Empty fixtures return no execution and a skipped diagnostic |
| Provider unavailable | Detection source throws or returns unavailable | No claim is executed and diagnostic audit is recorded | Failure is isolated so later wallets can still be evaluated |
| Policy pass | Claimable reward value meets minimum and gas estimate is within max | Policy decision allows claim with matching tool, signer, target, and calldata summary | Decision expires or mismatches execution request, so Somnia client rejects |
| Policy fail | Auto-claim disabled, reward below minimum, gas too high, or unsupported action | Claim is skipped/denied and reason is persisted | No transaction is signed |
| Execution outcome | Policy allowed and Somnia adapter succeeds or fails | Attempt plus success/failure record includes reward, gas, and tx hash when available | RPC/signing/adapter errors are recorded without unsafe retry |
| Telegram report | Wallet has Telegram binding and outcome is recorded | User receives concise claim/skip/failure notification | Missing/unhealthy Telegram records skipped notification audit |

</frozen-after-approval>

## Code Map

- `agent/src/persistence/reward-claims.repository.ts` -- Existing minimal repository; expand for settings, fixtures, detections, outcomes, and lookup helpers.
- `agent/src/policies/reward-claim-policy.ts` -- New deterministic policy for reward thresholds and unsupported action denial.
- `agent/src/services/reward-claim.service.ts` -- New service for configure/status/detect/evaluate/execute/notify flows.
- `agent/src/jobs/reward-claim.job.ts` -- New job boundary that evaluates all configured wallets and isolates per-wallet failures.
- `agent/src/integrations/somnia/somnia-agent-kit.client.ts` -- Existing policy-enforced state-changing execution boundary; use for approved claim tool calls.
- `agent/src/integrations/telegram/telegram.client.ts` -- Existing Telegram client; use through a small reward outcome notifier.
- `agent/src/api/server.ts` -- Add reward settings, status, detection/run, and policy-check routes using existing response conventions.
- `agent/src/main.ts` -- Wire reward repository, service, notifier, job dependencies, and runtime API dependencies.
- `agent/src/index.ts` -- Export Epic 5 repository, service, job, policy, and notifier primitives.
- `agent/src/**/*.test.ts` -- Add unit/API coverage for matrix edge cases, policy decisions, persistence, notification behavior, and runtime wiring.

## Tasks & Acceptance

**Execution:**
- [x] `agent/src/persistence/reward-claims.repository.ts` -- expand schemas and methods for settings, demo fixtures, claim records, and wallet-based listing -- required for deterministic local/demo reward workflows.
- [x] `agent/src/policies/reward-claim-policy.ts` -- implement allow/skip/deny decisions for auto-claim, value, gas, supported action, signer, chain, target, calldata summary, and expiry -- prevents unsafe signing.
- [x] `agent/src/services/reward-claim.service.ts` -- implement configure/status/detect/run/policy-check/execute flows with audit events and per-wallet error isolation -- centralizes Epic 5 behavior.
- [x] `agent/src/jobs/reward-claim.job.ts` -- expose scheduled runner wrapper over the service -- aligns with existing job architecture.
- [x] `agent/src/services/reward-claim-notifier.ts` -- send Telegram outcome messages when binding and client health allow, otherwise audit skipped/failed notification -- completes user reporting without coupling service to Telegram details.
- [x] `agent/src/api/server.ts` -- add reward routes and service dependency handling -- makes Epic 5 testable through the existing API boundary.
- [x] `agent/src/main.ts` -- instantiate reward dependencies and expose them to the API/runtime -- enables the feature in normal startup.
- [x] `agent/src/index.ts` -- export public Epic 5 modules -- keeps tests and downstream code consistent.
- [x] `agent/src/**/*.test.ts` -- cover the I/O matrix, policy mismatch rejection, unsupported action denial, failed provider detection, failed execution recording, Telegram skip paths, and route validation -- guards the safety boundary.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark Epic 5 and its stories in-progress/review-ready after verification -- keeps BMad tracking current.

**Acceptance Criteria:**
- Given reward settings are saved for a monitored wallet, when status is requested, then the response includes auto-claim state, minimum reward USD, maximum gas USD, and latest claim outcome.
- Given demo fixture rewards exist, when the reward job runs, then claimable rewards are detected and each reward is either skipped with a reason or attempted only after policy approval.
- Given auto-claim is disabled, value is below threshold, gas exceeds threshold, or the requested action is unsupported, when policy evaluation completes, then no Somnia state-changing call is made and the denial/skip is auditable.
- Given policy allows a claim and the Somnia adapter returns a transaction hash, when execution completes, then the claim is recorded as succeeded and Telegram is notified when configured.
- Given execution or notification fails, when the flow completes, then the failure is recorded without leaking secrets and later wallets can continue processing.

### Review Findings

- [x] [Review][Patch] Successful demo fixtures remained claimable and could be claimed repeatedly by later job runs [agent/src/services/reward-claim.service.ts:360]
- [x] [Review][Patch] Unsupported autonomous action policy checks required reward settings instead of producing an auditable denial [agent/src/services/reward-claim.service.ts:170]

## Spec Change Log

## Design Notes

Use demo fixtures as the default detection source for Epic 5 so the feature is deterministic without a protocol-specific reward provider. Keep the integration seam explicit: a fixture can describe `protocol`, `rewardToken`, `valueUsd`, `gasUsd`, `target`, and `calldataSummary`, while the execution boundary still receives a policy-matched Somnia tool call. This keeps the MVP reviewable and leaves real protocol adapters as a human-approved future extension.

## Verification

**Commands:**
- `pnpm --dir agent lint` -- passed: TypeScript checks without emit.
- `pnpm --dir agent build` -- passed: agent compiles successfully.
- `pnpm --dir agent test` -- passed: 13 files / 93 tests.

## Suggested Review Order

**Reward Flow**

- Start here for the full configure, detect, policy, execute, notify orchestration.
  [`reward-claim.service.ts:98`](../../agent/src/services/reward-claim.service.ts#L98)

- Review unsupported-action denial and audit behavior before execution concerns.
  [`reward-claim.service.ts:176`](../../agent/src/services/reward-claim.service.ts#L176)

- Check fixture detection, provider failure isolation, and empty-fixture handling.
  [`reward-claim.service.ts:248`](../../agent/src/services/reward-claim.service.ts#L248)

- Inspect the final signing gate and success/failure recording path.
  [`reward-claim.service.ts:305`](../../agent/src/services/reward-claim.service.ts#L305)

**Policy And Persistence**

- Confirm the persisted shape covers settings, fixtures, claims, and policy decisions.
  [`reward-claims.repository.ts:19`](../../agent/src/persistence/reward-claims.repository.ts#L19)

- Verify successful fixtures become unclaimable to prevent duplicate demo claims.
  [`reward-claims.repository.ts:210`](../../agent/src/persistence/reward-claims.repository.ts#L210)

- Review threshold and unsupported-action policy decisions.
  [`reward-claim-policy.ts:31`](../../agent/src/policies/reward-claim-policy.ts#L31)

**API And Runtime**

- Check reward routes and response conventions.
  [`server.ts:220`](../../agent/src/api/server.ts#L220)

- Verify runtime dependency wiring for rewards, Somnia, and Telegram notifier.
  [`main.ts:119`](../../agent/src/main.ts#L119)

**Tests**

- Review successful execution and policy-gated Somnia adapter assertions.
  [`reward-claim.service.test.ts:93`](../../agent/src/services/reward-claim.service.test.ts#L93)

- Review duplicate prevention and unsupported-action denial coverage.
  [`reward-claim.service.test.ts:126`](../../agent/src/services/reward-claim.service.test.ts#L126)

- Review API coverage for reward settings, fixtures, status, run, and policy routes.
  [`server.test.ts:354`](../../agent/src/api/server.test.ts#L354)
