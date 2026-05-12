# Story 1.3: Add Structured Logging And Audit Event Foundation

Status: done

## Story

As an operator,
I want structured secret-safe logs and append-friendly audit records,
so that agent behavior can be inspected without leaking credentials.

## Acceptance Criteria

1. Given the agent emits operational logs, when logs include provider, wallet, policy, or transaction context, then pino outputs structured fields and configured secret fields are redacted.
2. Given a risk analysis, alert, policy decision, or transaction attempt occurs, when an audit event is recorded, then it is written through the audit repository and includes timestamp, event type, status, and safe metadata.

## Tasks / Subtasks

- [x] Add structured logger foundation (AC: 1)
  - [x] Add `agent/src/config/logger.ts`.
  - [x] Configure pino redaction for private keys, API keys, bot tokens, webhook secrets, and known nested secret paths.
- [x] Add append-friendly audit repository (AC: 2)
  - [x] Add `agent/src/persistence/audit-events.repository.ts`.
  - [x] Validate audit event shape with zod.
  - [x] Persist `createdAt`, `eventType`, `status`, and safe metadata.
- [x] Add audit service boundary (AC: 2)
  - [x] Add `agent/src/services/audit.service.ts`.
  - [x] Emit structured audit log records without secret values.
- [x] Verify behavior
  - [x] Add logger and audit persistence tests.
  - [x] Run agent lint, build, and tests.

### Review Findings

- [x] [Review][Patch] Audit events can persist and log unsanitized secret metadata [agent/src/persistence/audit-events.repository.ts:19]

## Dev Notes

Implemented as part of completing the remaining Epic 1 foundation work. This story stays scoped to logging and audit foundations; domain-specific audit events for risk, Telegram, policies, and transactions are wired by later epics.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --dir agent test` passed: 7 test files, 35 tests.
- `pnpm --dir agent lint` passed.
- `pnpm --dir agent build` passed.
- Code review patch validation passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, and `pnpm --dir agent test` passed with 7 test files and 43 tests.

### Completion Notes List

- Added pino logger factory with secret-safe redaction paths.
- Added zod-validated append-only audit event repository.
- Added audit service for persistence plus structured operational logging.
- Resolved review finding by sanitizing secret-looking audit metadata before persistence/logging.

### File List

- `agent/src/config/logger.ts`
- `agent/src/config/logger.test.ts`
- `agent/src/persistence/audit-events.repository.ts`
- `agent/src/services/audit.service.ts`
- `agent/src/persistence/json-store.ts`
- `agent/src/persistence/json-store.test.ts`
- `agent/src/index.ts`

### Change Log

- 2026-05-12: Implemented Story 1.3 and marked done.
- 2026-05-12: Applied code review patch and kept Story 1.3 done.
