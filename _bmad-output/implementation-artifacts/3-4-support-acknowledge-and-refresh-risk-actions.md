# Story 3.4: Support Acknowledge And Refresh Risk Actions

Status: done

## Story

As a user,
I want to acknowledge alerts and request refreshed analysis from Telegram,
so that I can manage risk notifications quickly.

## Acceptance Criteria

1. Given a valid acknowledge callback is received, when the agent processes it, then the alert is marked acknowledged and the user receives confirmation.
2. Given a valid refresh-analysis callback is received, when the agent processes it, then a new risk analysis is requested and the refreshed result is sent back to Telegram.

## Tasks / Subtasks

- [x] Add alert acknowledgment persistence.
- [x] Add acknowledge callback handler.
- [x] Add refresh-analysis callback handler using latest portfolio state.
- [x] Add tests for acknowledge and refresh behavior.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-3.md`.
- Refresh analysis fails closed when no latest portfolio is available or risk analysis fails.

### File List

- `agent/src/persistence/alerts.repository.ts`
- `agent/src/services/telegram-alert.service.ts`
- `agent/src/services/telegram-alert.service.test.ts`

### Change Log

- 2026-05-13: Implemented Story 3.4.
