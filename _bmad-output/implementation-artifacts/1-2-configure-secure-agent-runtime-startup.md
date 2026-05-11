# Story 1.2: Configure Secure Agent Runtime Startup

Status: done

## Story

As an operator,
I want the agent to validate environment configuration before startup,
so that missing secrets, wrong chain settings, or unsafe runtime states fail closed.

## Acceptance Criteria

1. Given required environment variables are missing or malformed, when the agent starts, then zod validation fails with a safe diagnostic message, and the agent does not start background jobs or expose execution endpoints.
2. Given valid environment variables are present, when the agent starts, then typed config is available to services, and no secret values are printed to logs.

## Tasks / Subtasks

- [x] Create typed runtime config module (AC: 1, 2)
  - [x] Add `agent/src/config/env.ts` with a zod schema for required agent runtime configuration.
  - [x] Load local `.env` through `dotenv` before parsing `process.env`.
  - [x] Export `AgentConfig`, `loadConfig()`, and the schema for tests.
  - [x] Keep derived booleans/numbers typed; do not leave validated numeric settings as strings.
- [x] Define fail-closed startup behavior (AC: 1)
  - [x] Update `agent/src/main.ts` so config validation is the first runtime operation.
  - [x] Ensure invalid config exits before any future API server, Telegram polling, cron job, signer, or provider startup hook can run.
  - [x] Preserve the Windows-safe entrypoint check from Story 1.1.
- [x] Add safe diagnostics for config failures (AC: 1, 2)
  - [x] Create a helper that formats validation errors with variable names and actionable messages only.
  - [x] Redact or omit secret-bearing values from diagnostics: private keys, API keys, bot tokens, webhook secrets, and RPC credentials.
  - [x] Avoid logging raw `process.env`, stack traces, or complete provider URLs.
- [x] Align environment documentation (AC: 1, 2)
  - [x] Review `.env.example` against the implemented schema.
  - [x] Add missing non-secret variable names only if required by the schema.
  - [x] Do not add real values or secrets.
- [x] Add focused tests (AC: 1, 2)
  - [x] Test missing required config returns safe failure diagnostics.
  - [x] Test malformed numeric, boolean, URL, private key, chain ID, and address fields are rejected.
  - [x] Test valid demo/testnet config produces a typed `AgentConfig`.
  - [x] Test diagnostics do not include secret input values.

### Review Findings

- [x] [Review][Patch] CLI startup prints an unhandled exception instead of the safe config diagnostic [agent/src/main.ts:19]
- [x] [Review][Patch] Whitespace-only required secrets and model names pass validation [agent/src/config/env.ts:73]
- [x] [Review][Patch] Integer env parsing can silently round unsafe values [agent/src/config/env.ts:30]
- [x] [Review][Patch] Partial Telegram configuration is silently accepted as disabled [agent/src/config/env.ts:139]
- [x] [Review][Patch] Private-key validation accepts cryptographically invalid keys [agent/src/config/env.ts:8]
- [x] [Review][Patch] Agent wallet address is not checked against the configured private key [agent/src/config/env.ts:71]
- [x] [Review][Patch] Dotenv loading depends on the process working directory [agent/src/config/env.ts:176]

## Dev Notes

This story is the runtime safety gate. Keep it scoped to configuration validation and startup sequencing. Do not implement portfolio monitoring, REST API routes, Telegram bot behavior, cron jobs, policy gates, wallet setup, or JSON repositories here.

### Required Environment Shape

Use the existing `.env.example` as the public contract unless a missing key is discovered. Required fields for this story:

- `NODE_ENV`: enum-like string, default acceptable for local dev: `development`.
- `LOG_LEVEL`: enum-like string such as `trace`, `debug`, `info`, `warn`, `error`, `fatal`; default acceptable: `info`.
- `SOMNIA_RPC_URL`: valid URL.
- `SOMNIA_CHAIN_ID`: positive integer.
- `AGENT_WALLET_ADDRESS`: EVM address.
- `AGENT_PRIVATE_KEY`: 32-byte hex private key with `0x` prefix.
- `GROQ_API_KEY`: non-empty string.
- `GROQ_MODEL`: non-empty string.
- `DEEPSEEK_API_KEY`: non-empty string.
- `DEEPSEEK_MODEL`: non-empty string.
- `RISK_SCORE_ALERT_THRESHOLD`: integer `0-100`.
- `HEARTBEAT_INTERVAL_SECONDS`: positive integer.
- `HEARTBEAT_GRACE_SECONDS`: positive integer.
- `DEAD_MAN_SWITCH_CONTRACT_ADDRESS`: EVM address; allow an explicit demo placeholder only if the implementation also has an explicit demo mode flag.
- `AUTO_CLAIM_ENABLED`: boolean parsed from string.
- `MAX_CLAIM_GAS_USD`: non-negative number.
- `MIN_REWARD_VALUE_USD`: non-negative number.
- `NEXT_PUBLIC_AGENT_API_URL` is frontend-facing and should not be required by the backend agent config.

Telegram values may be optional for this story if the implementation models Telegram as disabled until Story 3.1. If optional, invalid provided values must still fail validation. Do not silently accept malformed `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, or `TELEGRAM_WEBHOOK_SECRET`.

### Architecture Compliance

- Put runtime config in `agent/src/config/env.ts`.
- Keep `agent/src/main.ts` as the startup entrypoint and `agent/src/index.ts` as reusable exports for tests/scripts.
- Use zod for all config validation. Current lockfile resolves `zod@3.25.76`; use Zod 3-compatible APIs.
- Use dotenv only for local environment loading. Secrets still come from env, not source files.
- Fail closed on missing or malformed config. Future startup hooks must sit after validation.
- Do not expose secrets, private keys, raw provider tokens, full RPC URLs, or stack traces in public diagnostics.
- Do not introduce API response wrappers, persistence, pino audit logging, or policy-gate abstractions in this story; those belong to later stories unless needed for minimal validation tests.

### Existing Files To Touch

- `agent/src/main.ts`: currently only has an empty `main()` and a Windows-safe `pathToFileURL(process.argv[1]).href` entrypoint check. Preserve that entrypoint check.
- `agent/src/index.ts`: currently exports `main`; extend it to export config helpers if useful for tests.
- `agent/package.json`: already contains `dotenv`, `zod`, `pino`, `node-cron`, `ethers`, and `viem`; do not switch package managers.
- `.env.example`: contains placeholder variable names. Keep real secrets out.

### Testing Requirements

Use Vitest. Prefer co-located tests:

- `agent/src/config/env.test.ts`
- Optional `agent/src/main.test.ts` if startup sequencing is testable without spawning a process.

Recommended commands:

```powershell
pnpm --dir agent lint
pnpm --dir agent test
```

If dependencies or local tools are unavailable, document the exact failed command and reason in the Dev Agent Record. Do not mark tests as passed without running them.

### Previous Story Intelligence

Story 1.1 established:

- Root workspace uses `pnpm@10.23.0` and fail-fast recursive scripts.
- `agent/src/main.ts` uses a Windows-safe entrypoint comparison. Keep this intact.
- Dependencies have since been installed; `pnpm-lock.yaml` currently resolves `dotenv@16.6.1`, `zod@3.25.76`, `pino@9.14.0`, `ethers@6.16.0`, `viem@2.48.11`, and `@types/node@22.19.18`.
- No Git repository is present, so use file inspection rather than commit history.

### Latest Technical Notes

- Node.js documents `process.env` as the basic environment variable API and notes `.env` values parse as strings, so this story must explicitly coerce numbers and booleans.
- dotenv `config()` reads `.env`, parses it, and populates `process.env`; use it before zod parsing.
- Zod is the chosen schema library; current project dependency is Zod 3, so avoid Zod 4-only helpers.
- Pino supports redaction, but Story 1.3 owns structured logging. This story may define secret key lists that Story 1.3 can reuse.

References:
- [epics.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/epics.md) Story 1.2, FR40, FR41, FR43, NFR5, NFR13, NFR28.
- [architecture.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/architecture.md) Structure Patterns, Error Handling Patterns, Execution Safety Patterns, Project Structure & Boundaries.
- [prd.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/prd.md) Security, Reliability, Integration, Blockchain Web3 requirements.
- Node.js Environment Variables: https://nodejs.org/api/environment_variables.html
- dotenv package docs: https://www.npmjs.com/package/dotenv
- Zod docs: https://zod.dev/
- Pino redaction docs: https://github.com/pinojs/pino/blob/main/docs/redaction.md

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --dir agent test` failed because PowerShell blocked `pnpm.ps1`; used `pnpm.cmd` for Windows-safe command execution.
- `pnpm.cmd --dir agent test` initially failed in sandbox with `EPERM: operation not permitted, lstat 'C:\Users\T'`; reran outside sandbox with approval.
- Red phase confirmed tests failed before implementation because `agent/src/config/env.ts` did not exist.
- `pnpm.cmd --dir agent test` passed after implementation: 2 test files, 14 tests.
- `pnpm.cmd --dir agent lint` passed.
- `pnpm.cmd --dir agent build` passed.
- `pnpm.cmd lint` passed across configured workspaces.
- `pnpm.cmd test` did not complete because `contracts` delegates to `forge test` and Foundry is not installed on this machine; agent and frontend portions completed or were separately validated.
- Code review patch validation: `pnpm.cmd --dir agent test` passed with 2 test files and 21 tests.
- Code review patch validation: `pnpm.cmd --dir agent lint`, `pnpm.cmd --dir agent build`, and `pnpm.cmd lint` passed.
- Code review patch validation: secret-pattern scan of changed agent files returned no matches.
- Code review patch validation: `pnpm.cmd test` still fails at `contracts` because `forge` is not installed.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Implemented typed zod runtime config validation with dotenv loading, numeric/boolean coercion, EVM address/private-key validation, optional Telegram validation, and exported config helpers.
- Updated agent startup so configuration is loaded before any runtime hook can start; invalid config prevents `startRuntime` execution.
- Added secret-safe diagnostic formatting that reports variable names and validation messages without echoing input values.
- Reviewed `.env.example`; no new variable names were required for this story.
- Added Vitest coverage for valid config typing, missing config, malformed values, optional Telegram validation, secret-safe diagnostics, and startup fail-closed ordering.
- Resolved code review findings by adding CLI-safe config diagnostics, trimmed required strings, safe integer checks, all-or-nothing Telegram config validation, secp256k1 private-key validation, private-key/address consistency checks, deterministic root `.env` loading, and regression tests.

### File List

- `_bmad-output/implementation-artifacts/1-2-configure-secure-agent-runtime-startup.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `agent/src/config/env.ts`
- `agent/src/config/env.test.ts`
- `agent/src/main.ts`
- `agent/src/main.test.ts`
- `agent/src/index.ts`

### Change Log

- 2026-05-11: Implemented Story 1.2 secure runtime config validation and moved story to review.
- 2026-05-11: Applied code review patches and marked Story 1.2 done.
