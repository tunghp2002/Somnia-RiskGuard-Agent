# Story 2.1: Monitor Portfolio State For Configured Wallets

Status: review

## Story

As a user,
I want the agent to read my Somnia portfolio state,
so that risk analysis is based on current wallet information.

## Acceptance Criteria

1. Given a monitored wallet is configured, when the portfolio monitor job runs, then the agent reads wallet state from Somnia Testnet or explicit demo fixtures and records the latest portfolio snapshot.
2. Given chain configuration is invalid, when monitoring runs, then the monitor fails closed and a subsystem health error is recorded.

## Tasks / Subtasks

- [x] Add portfolio snapshot repository.
- [x] Add portfolio service with demo/read-only Somnia collection path.
- [x] Audit successful snapshot collection and no-wallet skips.
- [x] Add tests for configured and empty wallet monitoring paths.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-2.md`.
- Verification passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, `pnpm --dir agent test` with 10 test files and 51 tests.

### File List

- `agent/src/persistence/portfolio-snapshots.repository.ts`
- `agent/src/services/portfolio.service.ts`
- `agent/src/services/portfolio.service.test.ts`
- `agent/src/jobs/portfolio-monitor.job.ts`
- `agent/src/jobs/portfolio-monitor.job.test.ts`

### Change Log

- 2026-05-13: Implemented Story 2.1 and moved to review.
