---
title: 'Full Epic 7: Runtime Integration & MVP Acceptance Hardening'
type: 'feature'
created: '2026-05-15'
status: 'done'
baseline_commit: 'e20b548991f9b5474b8271a4408cbc8912504ae6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-design-specification.md'
  - '{project-root}/.agents/skills/shadcn-ui-design-system/SKILL.md'
---

## Intent

**Problem:** Epics 1-6 created the core slices, but the MVP still needs runtime acceptance hardening and a dashboard IA pass. The current UI direction can become hard to manage if every capability stays on one screen, Telegram setup should not require manual chat-id entry, and public chain metadata should not be treated as private env configuration.

**Approach:** Complete Epic 7 by hardening normal runtime behavior, smoke checks, demo/testnet labeling, Somnia adapter gating, operational UX, and the new Story 7.6 redesign/config work. The dashboard becomes a multi-section app shell using shadcn/ui-style components, while public chain metadata moves to `config/public-chains.json`.

## Boundaries & Constraints

**Always:** Keep secrets in env only; keep public chain metadata in config; keep browser wallet separate from backend agent wallet; use shadcn/ui-style primitives when practical; label demo/simulation/testnet mode at action points; preserve secret-safe audit output; keep frontend as API orchestration and display.

**Ask First:** Adding a database, replacing the wallet model, changing Telegram security semantics, removing demo mode, replacing the Tailwind/shadcn stack, or introducing a new auth provider beyond the current wallet/signed-proof direction.

**Never:** Do not ask users to type Telegram chat id as the primary setup path, do not silently mix demo data into testnet mode, do not expose private keys/tokens/API keys, do not put every workflow into one screen, and do not bypass deterministic policy gates.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Normal runtime | `pnpm dev` with valid config | Agent API, scheduled jobs, frontend reads, and health checks run through normal path | Startup/config failures fail closed with actionable secret-safe messages |
| Smoke checks | Dev servers running | Health, frontend HTTP, reads, demo scenario, and audit redaction are verified | Failing smoke check reports exact subsystem |
| Demo/testnet display | Demo fixture or testnet-backed result | UI labels source of result clearly | Testnet mode never silently shows demo data |
| Adapter unavailable | Somnia adapter/config missing | Execution-capable flows are disabled or fail closed with receipt | No false claim of live execution |
| Desktop dashboard | Wide viewport | Persistent left sidebar with focused sections | Active route and unavailable state are visible |
| Mobile dashboard | Mobile viewport | Bottom navigation plus More sheet/menu | Touch targets and labels remain accessible |
| Telegram setup | User selects Connect Telegram | Bot link/code/QR callback flow binds Telegram identity | Expired/failed connection can retry without manual chat id |
| Chain metadata | Frontend/agent needs chain id/RPC/explorer/contracts | Reads from `config/public-chains.json` | Invalid public config fails closed; secrets still env-driven |

## Code Map

- `config/public-chains.json` -- public Somnia chain metadata shared by frontend and agent.
- `frontend/src/app/*` -- app shell/route composition for multi-section dashboard.
- `frontend/src/components/ui/*` -- reusable shadcn/ui-style primitives and local wrappers.
- `frontend/src/features/dashboard/*` -- Overview, status summary, receipts, health, and demo surfaces.
- `frontend/src/features/settings/*` -- focused setup screens, account/session controls, Telegram Connect.
- `frontend/src/lib/agent-api.ts` -- typed API client for setup, Telegram binding, health, audit, demo, and public config-backed calls.
- `frontend/src/lib/wallet.ts` -- wallet connect/disconnect/session behavior without private-key handling.
- `agent/src/config/*` -- runtime config validation and public chain config loader.
- `agent/src/api/server.ts` -- endpoints for Telegram connect/binding, health, audit, smoke support, and existing setup reads.
- `agent/src/integrations/telegram/*` -- bot link/code/callback binding support where needed.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- Epic 7 story tracking.

## Tasks & Acceptance

**Story 7.6: Redesign Dashboard IA, Telegram Connect, And Public Chain Config**

- [x] Add or finalize a typed public chain config loader for `config/public-chains.json`.
- [x] Migrate non-secret chain id, public RPC URL, explorer URL, native currency, and public contract address reads away from env-only usage.
- [x] Keep env validation for secrets and credentials only; preserve legacy env fallback only if clearly labeled temporary.
- [x] Build/refactor the frontend app shell with desktop left sidebar and mobile bottom navigation.
- [x] Split the current dashboard into focused sections: Overview, Setup, Risk, Heartbeat, Rewards, Receipts, Demo, and Health.
- [x] Add account/session controls for restoring, connected, disconnected, expired, disconnecting, and error states.
- [x] Replace manual Telegram chat-id UX with Connect Telegram via bot deep link, one-time code, QR/link fallback, or equivalent callback flow.
- [x] Replace custom UI surfaces with shadcn/ui-style primitives or local wrappers where practical.
- [x] Update smoke checks or manual verification notes to cover desktop navigation, mobile navigation, disconnect/sign out, Telegram Connect, and public config loading.
- [x] Update sprint status when implementation reaches review.

**Acceptance Criteria:**

- Given desktop viewport, when the dashboard loads, then left sidebar navigation exposes focused sections and Overview is not a mega-screen.
- Given mobile viewport, when the dashboard loads, then primary navigation is a bottom bar and lower-frequency sections are reachable through More.
- Given account state changes, when connect/disconnect/sign out/session restore occurs, then UI state and wallet-specific data update predictably.
- Given Telegram setup, when the user selects Connect Telegram, then the app uses a bot/code/callback style flow and does not ask for manual chat id.
- Given chain metadata is needed, when frontend or agent reads it, then non-secret values come from `config/public-chains.json`.
- Given a shadcn/ui primitive fits, when implementing the redesign, then local wrappers/primitives are used instead of one-off handcrafted UI.

## Verification

Run or update these as implementation allows:

- `pnpm --dir frontend lint`
- `pnpm --dir frontend build`
- `pnpm --dir agent lint`
- `pnpm --dir agent test`
- local runtime smoke check covering agent health, frontend load, demo scenario, audit redaction, navigation, disconnect, Telegram Connect, and public chain config.

## Implementation Notes

- Added `agent/src/config/public-chain.ts` and `/api/public-chain` so public chain id, RPC, explorer, native currency, and public contract metadata load from `config/public-chains.json`.
- Updated agent config to use public config defaults while retaining env overrides only as legacy fallback for Somnia RPC/chain/contract values; secrets remain env-driven.
- Exposed Somnia adapter health and public chain metadata through `/api/health`.
- Reworked the frontend dashboard into focused sections with desktop sidebar navigation and mobile bottom navigation plus a More sheet.
- Replaced the user-facing Telegram chat-id form with a Telegram Connect code/deep-link panel.
- Added account restoration/disconnect state handling and wallet-specific state clearing on disconnect.
- Added `scripts/runtime-smoke.mjs` and `pnpm smoke:runtime` for local runtime smoke verification.

## Verification Results

- `pnpm --dir frontend lint` passed.
- `pnpm --dir agent lint` passed.
- `pnpm --dir agent test` passed: 13 files, 95 tests.
- `pnpm --dir agent build` passed.
- `pnpm --dir frontend build` passed after rerunning outside the sandbox; the initial sandbox run failed because Turbopack could not bind a local process/port under sandbox restrictions.
- Code review patch pass resolved 9/9 findings and re-ran `pnpm --dir frontend lint`, `pnpm --dir agent lint`, `pnpm --dir agent test`, `pnpm --dir agent build`, and `pnpm --dir frontend build`.

### Review Findings

- [x] [Review][Patch] Telegram Connect cannot complete a binding — `/api/telegram/connect/start` creates a code but does not persist a session, `/api/telegram/connect/status` always returns `waiting`, the frontend never polls status, and the removed chat-id form means users have no working way to bind Telegram. [agent/src/api/server.ts:394]
- [x] [Review][Patch] Telegram deep link is not a bot connect link — the returned `https://t.me/share/url` URL only opens Telegram sharing and does not target a bot `/start` flow or carry a token the backend can consume. [agent/src/api/server.ts:423]
- [x] [Review][Patch] Public chain config path depends on process cwd — `resolve(process.cwd(), "../config/public-chains.json")` only works when the agent starts from `/agent` and can fail from repo root, compiled output, or a service manager. [agent/src/config/public-chain.ts:7]
- [x] [Review][Patch] Public chain env overrides still drive public metadata — `SOMNIA_RPC_URL`, `SOMNIA_CHAIN_ID`, and `DEAD_MAN_SWITCH_CONTRACT_ADDRESS` override `config/public-chains.json`, which contradicts the requirement that public metadata come from config with env reserved for secrets/credentials. [agent/src/config/env.ts:242]
- [x] [Review][Patch] Public config contract schema/type mismatch — backend parsing requires `contracts.deadManSwitch` to exist while frontend API types it as optional. [agent/src/config/public-chain.ts:18]
- [x] [Review][Patch] Account/session behavior is incomplete — `expired` is declared but never set, there is no account/chain change listener, stale in-flight loads can repopulate wallet/demo state after mode switch or disconnect, and account state is rendered as raw status text. [frontend/src/features/dashboard/riskguard-dashboard.tsx:164]
- [x] [Review][Patch] Mobile More sheet remains open after primary navigation — tapping Overview/Setup/Risk/Receipts does not close the open More sheet. [frontend/src/features/dashboard/riskguard-dashboard.tsx:651]
- [x] [Review][Patch] shadcn/ui adoption requirement is largely bypassed — the patch adds custom raw controls for sidebar, More sheet, account status, Telegram Connect, forms, and alerts instead of local shadcn-style primitives or wrappers where practical. [frontend/src/features/dashboard/riskguard-dashboard.tsx:405]
- [x] [Review][Patch] Runtime smoke script misses required checks and allows degraded health — `pnpm smoke:runtime` does not exercise navigation, disconnect/sign out, or Telegram Connect, and `ok:false` health is reported as a successful degraded check. [scripts/runtime-smoke.mjs:33]
