# Story 2.4: Enforce Advisory Risk Explanation Boundaries

Status: done

## Story

As a user,
I want Risk Score output to be clear and non-advisory,
so that the agent explains risk without pretending to be a financial advisor.

## Acceptance Criteria

1. Given a risk analysis is generated, when the explanation is returned, then it includes user-readable reasons for the score and frames output as informational analysis rather than investment advice.
2. Given an LLM response proposes unsupported trading or arbitrary transfers, when the response is processed, then unsafe recommendations are excluded from executable actions and only safe suggested next steps are displayed.

## Tasks / Subtasks

- [x] Add non-advisory prompt constraints.
- [x] Add advisory-boundary filtering in risk score processing.
- [x] Ensure executable actions are not produced from LLM output.
- [x] Add tests for unsafe wording filtering.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-2.md`.
- Verification passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, `pnpm --dir agent test` with 10 test files and 51 tests.
- Code review patch validation passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, and `pnpm --dir agent test` with 10 test files and 61 tests.

### File List

- `agent/src/integrations/llm/risk-prompt.ts`
- `agent/src/services/risk-score.service.ts`
- `agent/src/services/risk-score.service.test.ts`

### Change Log

- 2026-05-13: Implemented Story 2.4 and moved to review.
- 2026-05-13: Applied code review patches and marked Story 2.4 done.
