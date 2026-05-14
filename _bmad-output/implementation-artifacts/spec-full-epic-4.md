---
title: 'Full Epic 4: Heartbeat Timer & Dead Man''s Switch Protection'
type: 'feature'
created: '2026-05-14'
status: 'done'
baseline_commit: '56d7c7ef3a41a7f9acd23d4256b743e5d2cb6b3b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The agent can monitor risk and send Telegram actions, but it has no heartbeat timer, Dead Man's Switch contract, beneficiary status, reminder loop, or deterministic guard against premature emergency execution. Without Epic 4, the demo cannot prove offline-user protection or false-trigger prevention.

**Approach:** Implement Epic 4 as a contract-plus-agent safety slice: a minimal Foundry Dead Man's Switch contract, typed heartbeat persistence and APIs, reminder/missed-heartbeat job behavior, beneficiary-safe status messaging, and policy gates that deny emergency execution until persisted configuration and contract state agree that it is available.

## Boundaries & Constraints

**Always:** Keep contract state authoritative for expiry/timelock execution availability; validate all API and persistence inputs with zod; checksum-normalize wallet addresses; write heartbeat state only through repositories; record audit events for settings, check-ins, reminders, missed deadlines, policy denials, and availability decisions; preserve existing `{ data, meta }` / `{ error }` API responses; keep all signing/execution guarded by deterministic policies.

**Ask First:** Adding external Solidity dependencies, changing Telegram callback signing semantics, submitting real transactions, deploying to Somnia Testnet, adding frontend screens, or expanding DMS execution into arbitrary transfers or estate-management behavior.

**Never:** Do not store private keys or secrets in JSON, do not let off-chain reminders alone authorize execution, do not bypass policy gates, do not execute before expiry and timelock completion, do not implement unrestricted transfer/trade/rebalance actions, and do not weaken existing Telegram/risk behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Configure heartbeat | Monitored wallet, interval, grace period, timelock, beneficiary | Settings persist, status exposes next deadline and beneficiary | Invalid wallet/duration/beneficiary returns validation failure |
| Check in | Configured heartbeat before or after reminder state | Last heartbeat and next deadline update, audit records success | Missing settings fails closed without creating partial state |
| Reminder due | Deadline is within reminder window and no reminder sent for period | Reminder result is recorded and optional Telegram send is attempted when bound | Duplicate reminders are skipped and audited |
| Expired/timelock | Deadline plus grace has passed | Status reports expired or timelock pending/readiness from contract-compatible state | Missing contract state reports unavailable, not executable |
| Beneficiary status | Beneficiary or dashboard requests status | Response explains current state, beneficiary wallet, available next step, and return time | Unknown wallet or non-beneficiary request returns safe unavailable status |
| Premature execution | Request before expiry, before timelock, wrong beneficiary, or missing policy inputs | Policy denies and audit records reason; no transaction is signed | Unsupported action remains outside MVP scope |

</frozen-after-approval>

## Code Map

- `contracts/src/DeadManSwitch.sol` -- New authoritative heartbeat, expiry, timelock, beneficiary, and safe-execution state.
- `contracts/test/DeadManSwitch.t.sol` -- Foundry coverage for renewal, expiry, timelock, unauthorized access, and false-trigger prevention.
- `agent/src/persistence/heartbeats.repository.ts` -- New JSON repository for heartbeat settings, check-ins, reminders, and simulated contract state.
- `agent/src/services/heartbeat.service.ts` -- New service for setup, check-in, status, beneficiary messaging, reminders, and missed-heartbeat evaluation.
- `agent/src/jobs/heartbeat.job.ts` -- New scheduled runner boundary for reminders and missed-heartbeat checks.
- `agent/src/policies/deadman-policy.ts` -- New deterministic policy for beneficiary execution availability and denial reasons.
- `agent/src/api/server.ts` -- Add heartbeat setup, check-in, status, beneficiary status, and policy-check routes.
- `agent/src/index.ts` -- Export Epic 4 repositories, service, job, and policy primitives.

## Tasks & Acceptance

**Execution:**
- [x] `contracts/src/DeadManSwitch.sol` -- add minimal Ownable-free contract using explicit owner state, beneficiary configuration, heartbeat renewal, expiry/timelock reads, and beneficiary-safe execution marker.
- [x] `contracts/test/DeadManSwitch.t.sol` -- test ownership, beneficiary updates, heartbeat renewal, expiry, timelock pending, execution availability, unauthorized rejection, and premature execution rejection.
- [x] `agent/src/persistence/heartbeats.repository.ts` -- add typed persistence for settings, reminders, check-ins, and demo contract-state overrides.
- [x] `agent/src/services/heartbeat.service.ts` -- implement configure/check-in/status/reminder/beneficiary flows with audit events and Telegram reminder hooks where binding exists.
- [x] `agent/src/jobs/heartbeat.job.ts` -- expose a runner that evaluates all configured heartbeats and limits duplicate reminders.
- [x] `agent/src/policies/deadman-policy.ts` -- deny unsupported or premature execution and allow only beneficiary-available state after expiry and timelock.
- [x] `agent/src/api/server.ts` -- expose heartbeat routes using existing response/error conventions.
- [x] `agent/src/**/*.test.ts` -- cover the I/O matrix, policy behavior, API validation, and audit records.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark Epic 4 and stories as ready for review after verification.

**Acceptance Criteria:**
- Given a configured monitored wallet, when heartbeat settings are saved, then current status includes next deadline, grace expiry, beneficiary wallet, and timelock information.
- Given the user checks in, when the request is valid, then the next deadline is renewed and an audit event is recorded.
- Given a deadline is approaching, when the heartbeat job runs, then one reminder per reminder period is recorded and duplicate sends are skipped.
- Given heartbeat expiry and timelock are not complete, when execution is evaluated, then policy denies with a clear reason and no signing occurs.
- Given expiry and timelock conditions are complete for the configured beneficiary, when status is requested, then the beneficiary path is reported available without executing automatically.

### Review Findings

- [x] [Review][Patch] Heartbeat config and check-in APIs do not require signed wallet proof [agent/src/api/server.ts:145]
- [x] [Review][Patch] Deadman policy-check trusts unsigned `requestedBy` request body [agent/src/api/server.ts:201]
- [x] [Review][Patch] Runtime has no contract-state reader, so beneficiary availability depends on mutable JSON state [agent/src/main.ts:93]
- [x] [Review][Patch] Telegram heartbeat reminders are not wired in runtime despite reminder hook [agent/src/main.ts:93]
- [x] [Review][Patch] Unknown beneficiary-status requests return `null` instead of a safe unavailable status [agent/src/services/heartbeat.service.ts:183]
- [x] [Review][Patch] Reconfiguring heartbeat preserves stale reminder/missed metadata [agent/src/persistence/heartbeats.repository.ts:110]
- [x] [Review][Patch] Reconfiguring heartbeat preserves stale contract state [agent/src/persistence/heartbeats.repository.ts:112]
- [x] [Review][Patch] Reminder notifier failure records cooldown before send and suppresses retry [agent/src/services/heartbeat.service.ts:326]
- [x] [Review][Patch] One reminder evaluation failure aborts all later wallets [agent/src/services/heartbeat.service.ts:221]
- [x] [Review][Patch] Missing contract readiness after timelock returns a stale past `returnAt` [agent/src/services/heartbeat.service.ts:373]
- [x] [Review][Patch] Owner can replace beneficiary after expiry/timelock readiness [contracts/src/DeadManSwitch.sol:63]
- [x] [Review][Patch] Foundry contract tests were not executed in this environment [contracts/test/DeadManSwitch.t.sol:1]

## Spec Change Log

## Design Notes

Use deterministic demo timestamps in tests and keep all time calculations injectable through service inputs. Persist simulated contract state only as a demo/test substitute for actual contract reads; policy language should still treat missing or non-ready contract state as unavailable.

## Verification

**Commands:**
- `pnpm --dir agent lint` -- passed: TypeScript checks without emit.
- `pnpm --dir agent build` -- passed: agent compiles successfully.
- `pnpm --dir agent test` -- passed: 12 files / 83 tests.
- `pnpm --dir contracts test` -- passed: Foundry v1.7.1 / Solc 0.8.35; 15 tests passed.

## Suggested Review Order

**Contract Safety**

- Start with the on-chain state model and access control.
  [`../../contracts/src/DeadManSwitch.sol`](../../contracts/src/DeadManSwitch.sol)

- Review the Foundry scenarios for false-trigger prevention.
  [`../../contracts/test/DeadManSwitch.t.sol`](../../contracts/test/DeadManSwitch.t.sol)

**Heartbeat Agent Flow**

- Review persisted heartbeat settings, schedule calculation, and contract-state override shape.
  [`../../agent/src/persistence/heartbeats.repository.ts`](../../agent/src/persistence/heartbeats.repository.ts)

- Review status transitions, check-ins, reminder deduplication, beneficiary messages, and policy audit calls.
  [`../../agent/src/services/heartbeat.service.ts`](../../agent/src/services/heartbeat.service.ts)

- Review scheduled job entry point.
  [`../../agent/src/jobs/heartbeat.job.ts`](../../agent/src/jobs/heartbeat.job.ts)

**Execution Policy And API**

- Review deterministic denial/allow conditions before any Dead Man's Switch execution.
  [`../../agent/src/policies/deadman-policy.ts`](../../agent/src/policies/deadman-policy.ts)

- Review route validation and response behavior for heartbeat and policy APIs.
  [`../../agent/src/api/server.ts`](../../agent/src/api/server.ts)

**Verification**

- Review service/API coverage for settings, check-ins, reminders, beneficiary status, and policy denial/allow.
  [`../../agent/src/services/heartbeat.service.test.ts`](../../agent/src/services/heartbeat.service.test.ts)
