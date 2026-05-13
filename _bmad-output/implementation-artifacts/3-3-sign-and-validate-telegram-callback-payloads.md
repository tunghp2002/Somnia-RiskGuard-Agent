# Story 3.3: Sign And Validate Telegram Callback Payloads

Status: done

## Story

As a user,
I want Telegram quick actions protected from replay or spoofing,
so that only valid actions can affect my agent configuration or execution flow.

## Acceptance Criteria

1. Given a quick action button is generated, when the callback payload is created, then it includes action type, user ID, nonce, expiry, and signature.
2. Given a callback is expired, replayed, malformed, or unsigned, when it is received, then the action is rejected and the rejection is recorded without executing side effects.

## Tasks / Subtasks

- [x] Add callback signing and verification helpers.
- [x] Add nonce creation and consume-once repository APIs.
- [x] Validate callback chat/user binding before side effects.
- [x] Add tests for expired and replayed callback rejection.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-3.md`.
- Callback signatures use Telegram webhook secret when available, otherwise bot token material, without persisting either.

### File List

- `agent/src/integrations/telegram/callback-signing.ts`
- `agent/src/persistence/action-nonces.repository.ts`
- `agent/src/services/telegram-alert.service.ts`
- `agent/src/services/telegram-alert.service.test.ts`

### Change Log

- 2026-05-13: Implemented Story 3.3.
