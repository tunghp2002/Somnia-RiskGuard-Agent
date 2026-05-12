# Story 1.4: Implement JSON Persistence Repositories

Status: done

## Story

As a developer,
I want typed JSON repositories under agent persistence,
so that MVP state is durable enough for demos without introducing a database.

## Acceptance Criteria

1. Given the agent needs to persist users, risk snapshots, nonces, reward claims, or audit events, when a repository writes data, then JSON is stored under `agent/src/persistence/data` and writes go through schema-validated repository helpers.
2. Given persisted JSON is malformed, when the repository loads state, then validation fails safely and the agent reports an actionable startup or repository error.

## Tasks / Subtasks

- [x] Add generic JSON store (AC: 1, 2)
  - [x] Add `agent/src/persistence/json-store.ts`.
  - [x] Support default values, schema validation, directory creation, and atomic temp-file writes.
  - [x] Wrap read/parse failures in `JsonRepositoryError`.
- [x] Add MVP repositories (AC: 1)
  - [x] Add users repository.
  - [x] Add audit events repository.
  - [x] Add action nonces repository.
  - [x] Add risk snapshots repository.
  - [x] Add reward claims repository.
- [x] Add data directory boundary (AC: 1)
  - [x] Add `agent/src/persistence/data/.gitkeep`.
  - [x] Keep repository access behind helper classes.
- [x] Verify behavior
  - [x] Test valid writes and malformed JSON failure handling.
  - [x] Run agent lint, build, and tests.

### Review Findings

- [x] [Review][Patch] Default data directory moves to `agent/dist/persistence/data` after build, violating the configured persistence location [agent/src/persistence/json-store.ts:6]
- [x] [Review][Patch] Concurrent repository updates can lose records because read-modify-write is not serialized [agent/src/persistence/json-store.ts:69]
- [x] [Review][Patch] Concurrent writes share one fixed `.tmp` path and can overwrite or rename each other's payload [agent/src/persistence/json-store.ts:64]

## Dev Notes

Repositories intentionally remain lightweight for MVP demos. They provide typed file persistence and can later be swapped for SQLite/PostgreSQL behind the same service layer.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --dir agent test` passed: 7 test files, 35 tests.
- `pnpm --dir agent lint` passed.
- `pnpm --dir agent build` passed.
- Code review patch validation passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, and `pnpm --dir agent test` passed with 7 test files and 43 tests.

### Completion Notes List

- Added schema-validated JSON persistence helpers.
- Added repositories for current Epic 1 needs and later epic data categories.
- Added safe malformed JSON/schema failure path.
- Resolved review findings by pinning the default data directory to `agent/src/persistence/data`, serializing per-file updates, and using unique temporary write files.

### File List

- `agent/src/persistence/json-store.ts`
- `agent/src/persistence/json-store.test.ts`
- `agent/src/persistence/data/.gitkeep`
- `agent/src/persistence/users.repository.ts`
- `agent/src/persistence/audit-events.repository.ts`
- `agent/src/persistence/action-nonces.repository.ts`
- `agent/src/persistence/risk-snapshots.repository.ts`
- `agent/src/persistence/reward-claims.repository.ts`
- `agent/src/index.ts`

### Change Log

- 2026-05-12: Implemented Story 1.4 and marked done.
- 2026-05-12: Applied code review patches and kept Story 1.4 done.
