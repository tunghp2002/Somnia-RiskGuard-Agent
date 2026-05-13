# Story 3.1: Configure And Link Telegram Notifications

Status: done

## Story

As a user,
I want to link Telegram notification settings,
so that the agent can send alerts to the correct chat.

## Acceptance Criteria

1. Given a Telegram chat is linked to a monitored wallet, when settings are saved, then the agent persists the chat binding and validates required Telegram bot configuration.
2. Given Telegram config is missing or invalid, when notification setup or bot startup runs, then Telegram health reports failure and alerts are not attempted.

## Tasks / Subtasks

- [x] Add Telegram binding repository.
- [x] Add Telegram health and binding service behavior.
- [x] Add Telegram binding API route.
- [x] Add tests for binding and fail-closed health behavior.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-3.md`.
- Telegram config remains environment-driven and bindings are persisted without secrets.

### File List

- `agent/src/persistence/telegram-bindings.repository.ts`
- `agent/src/services/telegram-alert.service.ts`
- `agent/src/integrations/telegram/telegram.client.ts`
- `agent/src/api/server.ts`
- `agent/src/services/telegram-alert.service.test.ts`
- `agent/src/api/server.test.ts`

### Change Log

- 2026-05-13: Implemented Story 3.1.
