# Story 3.5: Route Safe Action Approvals Through Policy Gates

Status: done

## Story

As a user,
I want Telegram approvals to pass through deterministic policy gates,
so that quick actions cannot bypass execution safety.

## Acceptance Criteria

1. Given a Telegram callback approves a supported safe action, when the agent processes the approval, then the action is routed to the relevant policy gate before execution and policy denial prevents signing.
2. Given the requested action is unsupported, when the callback is processed, then the agent rejects the action and explains that unsupported actions are outside MVP scope.

## Tasks / Subtasks

- [x] Add Telegram safe-action policy helper.
- [x] Route approval callbacks through deterministic policy decisions.
- [x] Keep real signing/execution outside this epic.
- [x] Add tests for unsupported action denial.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-3.md`.
- Supported Telegram approvals only pass into downstream policy routing; no transaction is signed in this epic.

### File List

- `agent/src/policies/execution-policy.ts`
- `agent/src/services/telegram-alert.service.ts`
- `agent/src/services/telegram-alert.service.test.ts`

### Change Log

- 2026-05-13: Implemented Story 3.5.
