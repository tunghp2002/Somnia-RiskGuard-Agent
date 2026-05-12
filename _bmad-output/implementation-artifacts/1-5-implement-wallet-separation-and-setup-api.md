# Story 1.5: Implement Wallet Separation And Setup API

Status: done

## Story

As a user,
I want to register my monitored wallet while the agent uses its own executor wallet,
so that portfolio monitoring and safe actions do not require exposing my private keys.

## Acceptance Criteria

1. Given a browser wallet address is submitted to the agent API, when the setup request is valid, then the monitored wallet address is checksum-normalized and persisted and no private key is accepted or stored.
2. Given the backend agent wallet is configured through environment variables, when setup readiness is requested, then the API reports user wallet and agent wallet readiness separately and secret values are never returned.

## Tasks / Subtasks

- [x] Add setup service (AC: 1, 2)
  - [x] Validate setup payloads with zod.
  - [x] Reject unknown/private-key-bearing fields.
  - [x] Persist checksum-normalized monitored wallets via users repository.
  - [x] Report monitored wallet and agent wallet readiness separately.
- [x] Add local/demo REST API foundation (AC: 1, 2)
  - [x] Add response wrappers matching `{ data, meta }` and `{ error }`.
  - [x] Add `POST /api/users`.
  - [x] Add `GET /api/setup/readiness`.
  - [x] Add `GET /api/health`.
- [x] Add audit hook (AC: 1)
  - [x] Record `setup.wallet.registered` audit event on successful setup.
- [x] Verify behavior
  - [x] Test setup validation, readiness shape, no secret return, and API wrappers.
  - [x] Run agent lint, build, and tests.

### Review Findings

- [x] [Review][Patch] Setup accepts wallet registrations without signed-message ownership proof [agent/src/services/setup.service.ts:7]
- [x] [Review][Patch] Mixed-case invalid-checksum wallet input can escape zod and become a 500 response [agent/src/persistence/users.repository.ts:46]
- [x] [Review][Patch] Setup API reads request bodies without a size limit [agent/src/api/server.ts:10]
- [x] [Review][Patch] Readiness reports only the first stored monitored wallet, which can become stale after later setup calls [agent/src/services/setup.service.ts:46]
- [x] [Review][Patch] Health route can omit the required `data` response field when no health dependency is configured [agent/src/api/server.ts:48]

## Dev Notes

The API uses Node's built-in HTTP server to avoid adding Express/Fastify before route requirements justify another dependency. Later stories can extend the same response and route patterns.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --dir agent test` first failed in the sandbox because local loopback listen is blocked with `EPERM`.
- Reran `pnpm --dir agent test` with approved escalation for local loopback; passed: 7 test files, 35 tests.
- `pnpm --dir agent lint` passed.
- `pnpm --dir agent build` passed.
- Code review patch validation passed: `pnpm --dir agent lint`, `pnpm --dir agent build`, and `pnpm --dir agent test` passed with 7 test files and 43 tests.

### Completion Notes List

- Added setup service and REST API server foundation.
- Setup requests reject unknown fields, including private keys.
- Readiness response separates monitored wallet readiness from env-configured agent wallet readiness and omits secrets.
- Resolved review findings by requiring signed-message wallet ownership proof, validating checksum addresses in zod, adding a request body limit, reporting the latest monitored wallet, and guaranteeing health responses include `data`.

### File List

- `agent/src/services/setup.service.ts`
- `agent/src/services/setup.service.test.ts`
- `agent/src/api/response.ts`
- `agent/src/api/server.ts`
- `agent/src/api/server.test.ts`
- `agent/src/persistence/users.repository.ts`
- `agent/src/services/audit.service.ts`
- `agent/src/index.ts`

### Change Log

- 2026-05-12: Implemented Story 1.5 and marked done.
- 2026-05-12: Applied code review patches and kept Story 1.5 done.
