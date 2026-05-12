# Story 1.6: Create Somnia Agent Kit Integration Boundary

Status: done

## Story

As a developer/operator,
I want Somnia Agent Kit isolated behind a local integration client,
so that agent registration, tool calling, and on-chain interactions are policy-gated consistently.

## Acceptance Criteria

1. Given the agent needs to call a Somnia tool or perform a chain interaction, when the service invokes the Somnia integration, then calls flow through `somnia-agent-kit.client.ts` and state-changing calls require a policy decision object.
2. Given Somnia Agent Kit or RPC setup fails, when health is checked, then the failure is exposed as subsystem health and execution remains disabled.

## Tasks / Subtasks

- [x] Add execution policy decision shape (AC: 1)
  - [x] Add `agent/src/policies/execution-policy.ts`.
  - [x] Include `allowed`, `reason`, `policyId`, and `createdAt`.
- [x] Add Somnia integration boundary (AC: 1, 2)
  - [x] Add `agent/src/integrations/somnia/somnia-agent-kit.client.ts`.
  - [x] Initialize ethers provider and signer from validated config.
  - [x] Route tool calls through the local client boundary.
  - [x] Require allowed policy decisions for state-changing calls.
  - [x] Expose subsystem health with `executionEnabled: false` on adapter failure.
- [x] Verify behavior
  - [x] Test blocking state-changing calls without policy approval.
  - [x] Test allowing state-changing calls with policy approval.
  - [x] Test failed health disables execution.
  - [x] Run agent lint, build, and tests.

### Review Findings

- [x] [Review][Patch] State-changing policy approval is not bound to the requested tool, signer, chain, target, or calldata summary [agent/src/policies/execution-policy.ts:3]
- [x] [Review][Patch] Policy enforcement can be bypassed when a state-changing tool call omits `stateChanging: true` [agent/src/integrations/somnia/somnia-agent-kit.client.ts:65]
- [x] [Review][Patch] Somnia health reports execution enabled without checking RPC connectivity or adapter availability [agent/src/integrations/somnia/somnia-agent-kit.client.ts:44]
- [x] [Review][Patch] Tool calls silently appear successful when no Agent Kit adapter is configured [agent/src/integrations/somnia/somnia-agent-kit.client.ts:75]

## Dev Notes

The exact Somnia Agent Kit package API is intentionally represented as an adapter boundary here, because the architecture flags the exact API surface as implementation-time confirmation. This keeps later package integration isolated to one client file.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --dir agent test` passed with approved local loopback escalation: 7 test files, 35 tests.
- `pnpm --dir agent lint` passed.
- `pnpm --dir agent build` passed.
- Code review patch validation passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, and `pnpm --dir agent test` passed with 7 test files and 43 tests.

### Completion Notes List

- Added local Somnia Agent Kit client boundary.
- State-changing calls fail closed without an allowed policy decision.
- Health checks expose disabled execution on integration failure.
- Resolved review findings by binding policy decisions to action details, rejecting unclassified state-changing tools, failing when the adapter is missing, and reporting disabled health when integration is unavailable.

### File List

- `agent/src/policies/execution-policy.ts`
- `agent/src/integrations/somnia/somnia-agent-kit.client.ts`
- `agent/src/integrations/somnia/somnia-agent-kit.client.test.ts`
- `agent/src/index.ts`

### Change Log

- 2026-05-12: Implemented Story 1.6 and marked done.
- 2026-05-12: Applied code review patches and kept Story 1.6 done.
