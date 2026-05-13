# Story 2.3: Generate AI Risk Score With Groq And DeepSeek Fallback

Status: review

## Story

As a user,
I want an AI-generated Risk Score with provider fallback,
so that analysis remains available when the primary provider fails.

## Acceptance Criteria

1. Given portfolio context is ready for analysis, when Groq returns a valid response, then the agent produces a Risk Score from 0 to 100 and stores the provider, score, explanation, and timestamp.
2. Given Groq fails or times out, when fallback is available, then the agent retries with DeepSeek and records the fallback decision in logs and audit history.

## Tasks / Subtasks

- [x] Add bounded risk prompt builder.
- [x] Add Groq and DeepSeek provider clients with timeout and response validation.
- [x] Add risk score service with primary/fallback orchestration.
- [x] Add tests for primary success and fallback path.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-2.md`.
- Verification passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, `pnpm --dir agent test` with 10 test files and 51 tests.

### File List

- `agent/src/integrations/llm/risk-prompt.ts`
- `agent/src/integrations/llm/llm-risk.schema.ts`
- `agent/src/integrations/llm/groq.client.ts`
- `agent/src/integrations/llm/deepseek.client.ts`
- `agent/src/services/risk-score.service.ts`
- `agent/src/services/risk-score.service.test.ts`

### Change Log

- 2026-05-13: Implemented Story 2.3 and moved to review.
