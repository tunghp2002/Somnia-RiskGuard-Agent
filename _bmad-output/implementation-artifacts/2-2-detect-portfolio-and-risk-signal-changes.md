# Story 2.2: Detect Portfolio And Risk Signal Changes

Status: done

## Story

As a user,
I want the agent to detect meaningful portfolio or reward changes,
so that I am alerted only when the state warrants analysis.

## Acceptance Criteria

1. Given a previous portfolio snapshot exists, when a new snapshot is collected, then the agent identifies balance, reward, and configured risk-signal changes and stores whether a risk analysis should be triggered.
2. Given no meaningful change is detected, when monitoring completes, then the agent skips risk analysis and records a safe audit event.

## Tasks / Subtasks

- [x] Add deterministic change detection for total value, assets, rewards, and risk signals.
- [x] Add monitor job orchestration that calls risk analysis only when needed.
- [x] Audit skipped analysis when no meaningful change exists.
- [x] Add tests for changed and unchanged snapshots.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-2.md`.
- Verification passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, `pnpm --dir agent test` with 10 test files and 51 tests.
- Code review patch validation passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, and `pnpm --dir agent test` with 10 test files and 61 tests.

### File List

- `agent/src/services/portfolio.service.ts`
- `agent/src/services/portfolio.service.test.ts`
- `agent/src/jobs/portfolio-monitor.job.ts`
- `agent/src/jobs/portfolio-monitor.job.test.ts`

### Change Log

- 2026-05-13: Implemented Story 2.2 and moved to review.
- 2026-05-13: Applied code review patches and marked Story 2.2 done.
