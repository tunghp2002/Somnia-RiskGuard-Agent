# Story 2.5: Persist Risk Snapshots And Threshold Results

Status: review

## Story

As a user,
I want current and recent risk results persisted,
so that the dashboard and Telegram flows can display consistent risk state.

## Acceptance Criteria

1. Given a Risk Score is generated, when it is persisted, then the risk snapshot includes wallet address, score, explanation, provider, threshold result, and timestamp.
2. Given dashboard or Telegram flows need current state, when they request latest portfolio or risk state, then the agent API returns the latest persisted snapshot through the standard response wrapper.

## Tasks / Subtasks

- [x] Extend risk snapshot persistence shape and helper methods.
- [x] Persist threshold result and safe next steps.
- [x] Add latest portfolio and latest risk API read routes.
- [x] Add tests for repository/API reads.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-2.md`.
- Verification passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, `pnpm --dir agent test` with 10 test files and 51 tests.

### File List

- `agent/src/persistence/risk-snapshots.repository.ts`
- `agent/src/services/risk-score.service.ts`
- `agent/src/api/server.ts`
- `agent/src/api/server.test.ts`

### Change Log

- 2026-05-13: Implemented Story 2.5 and moved to review.
