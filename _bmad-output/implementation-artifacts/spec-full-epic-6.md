---
title: 'Full Epic 6: Dashboard, Demo Mode & Operator Visibility'
type: 'feature'
created: '2026-05-14'
status: 'done'
baseline_commit: '17229fb12c9083fe628401e23865199a3cd77f78'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-design-specification.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The backend agent, contracts, Telegram flows, heartbeat protection, and reward policy work are implemented, but users and judges still lack a dashboard that makes the guardian state, setup, demo mode, and operator diagnostics visible. Without Epic 6, the MVP cannot demonstrate the full Agentathon loop without terminal/log inspection.

**Approach:** Build a dark-mode-first Guardian Command Center dashboard backed by the existing agent API, add small missing API read/demo endpoints where needed, and expose setup forms, wallet identity, portfolio/risk/heartbeat/reward state, Safety Receipts, deterministic demo controls, and operator health in one cohesive frontend.

## Boundaries & Constraints

**Always:** Keep frontend wallet connection separate from backend agent wallet execution; never request or store private keys; label demo/simulation/testnet mode at action points; preserve existing agent `{ data, meta }` / `{ error }` API responses; display backend validation errors; show skipped/denied/failed actions as safety receipts; use plain-language state and non-color-only indicators; keep frontend logic to API orchestration and display.

**Ask First:** Adding auth beyond signed wallet proofs, integrating a real wallet SDK package, submitting live on-chain transactions from the dashboard, adding a database, changing backend policy semantics, or replacing the chosen Tailwind/shadcn-style visual direction.

**Never:** Do not duplicate backend monitoring/execution logic in frontend, silently fall back from testnet to simulation, expose secrets or sensitive payloads in logs, present AI output as transaction authorization, or create a marketing landing page instead of the usable dashboard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open dashboard | Frontend starts with agent reachable or unavailable | Guardian Command Center renders wallet setup, mode labels, readiness, and safe empty states | Agent failures show subsystem-specific unavailable states without crashing |
| Browser wallet | Injected EVM provider present or absent | Wallet address/network displays when connected; no private-key prompt appears | Missing provider shows manual/demo-safe guidance |
| Save settings | Risk, Telegram, heartbeat, beneficiary, reward form values | Dashboard calls agent API and refreshes readiness/status | Backend validation errors render inline |
| State overview | Portfolio/risk/heartbeat/reward/action data exists or is empty | Risk Score, heartbeat, DMS, reward policy, and Safety Receipts are shown | Loading/empty/error states include text labels |
| Demo controls | Demo mode active or testnet mode active | Demo scenarios are clearly labeled and update visible dashboard state | Testnet mode disables silent simulation |
| Operator health | Health/audit data exists | Subsystem health and secret-safe logs are visible | Sensitive fields are redacted or omitted |

</frozen-after-approval>

## Code Map

- `frontend/src/app/page.tsx` -- Replace placeholder with dashboard composition.
- `frontend/src/app/globals.css` -- Add dark-first cybernetic sentinel theme, light-mode support, layout tokens, and accessible state styles.
- `frontend/src/lib/agent-api.ts` -- New typed fetch helpers for setup, snapshots, heartbeat, rewards, health, audit, and demo endpoints.
- `frontend/src/lib/wallet.ts` -- New injected EVM wallet helper that reads address/network and signs messages without private-key access.
- `frontend/src/features/dashboard/*` -- New Guardian Command Center layout, status panels, Safety Receipts, demo controls, and operator health UI.
- `frontend/src/features/settings/*` -- New configuration forms for user wallet, Telegram, heartbeat/beneficiary, reward policy, and risk/demo settings.
- `agent/src/api/server.ts` -- Add read-only audit/recent-actions and deterministic demo scenario routes if not already present.
- `agent/src/services/demo-scenario.service.ts` -- New service to seed deterministic demo data through existing repositories/services.
- `agent/src/index.ts` / `agent/src/main.ts` -- Export and wire new demo/audit API dependencies.
- `frontend/src/**/*.test.tsx` or existing test surface -- Add feasible frontend unit tests if test infra exists; otherwise rely on build/lint plus focused agent API tests.

## Tasks & Acceptance

**Execution:**
- [x] `agent/src/api/server.ts` -- add recent audit/actions and demo scenario routes using existing response conventions -- supports dashboard timeline and demo controls.
- [x] `agent/src/services/demo-scenario.service.ts` -- seed deterministic setup/risk/reward/heartbeat/DMS-like demo states through existing repositories -- enables judge-friendly scenarios without real transactions.
- [x] `agent/src/main.ts` and `agent/src/index.ts` -- wire/export demo and audit read dependencies -- makes routes available in normal runtime and tests.
- [x] `agent/src/api/server.test.ts` -- cover new audit/demo routes, secret redaction, and validation/error behavior -- protects operator visibility.
- [x] `frontend/src/lib/agent-api.ts` -- implement typed API client with safe error objects and no direct JSON-file reads -- centralizes dashboard data access.
- [x] `frontend/src/lib/wallet.ts` -- implement injected wallet connect/network/sign helper without private-key handling -- supports setup and signed API forms.
- [x] `frontend/src/features/dashboard/*` -- build Guardian Command Center, Risk Score Circle, Wallet Role Chip, Safety Receipt timeline, heartbeat/DMS/reward panels, demo controls, and health row -- delivers the core UX.
- [x] `frontend/src/features/settings/*` -- build configuration forms with inline validation for setup, Telegram, heartbeat/beneficiary, rewards, and risk threshold placeholders where backend supports them -- lets users configure without JSON edits.
- [x] `frontend/src/app/page.tsx` and `frontend/src/app/globals.css` -- apply final page composition, dark/light visual foundation, responsive behavior, and accessibility states -- replaces placeholder screen.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark Epic 6 stories in progress/review after verification -- keeps BMad tracking current.

**Acceptance Criteria:**
- Given the frontend starts, when the dashboard loads, then Guardian Status, wallet connection, mode visibility, setup readiness, and safe empty/error states render.
- Given a browser wallet is connected, when the dashboard reads wallet state, then it displays address/network and never asks for a private key.
- Given the user submits MVP settings, when the backend accepts or rejects them, then the dashboard refreshes state or displays inline validation errors.
- Given agent state exists, when the overview renders, then portfolio/risk, heartbeat/DMS, reward policy, recent Safety Receipts, and subsystem health are visible without relying on color alone.
- Given demo mode is active, when the operator triggers scenarios, then results are clearly labeled as demo and no simulation/testnet mixing is hidden.

## Spec Change Log

## Design Notes

Use the Guardian Command Center as the first viewport, not a marketing page. If time forces tradeoffs, prioritize a cohesive visible demo loop over broad configurability: wallet/status, risk, heartbeat/DMS, reward policy, Safety Receipts, demo controls, and health. Keep any unsupported configuration visibly disabled with a reason instead of silently omitting it.

## Verification

**Commands:**
- `pnpm --dir agent lint` -- passed: TypeScript checks without emit.
- `pnpm --dir agent test` -- passed: 13 files / 95 tests.
- `pnpm --dir frontend lint` -- passed: TypeScript checks without emit.
- `pnpm --dir frontend build` -- passed: Next.js production build includes `/` under Route (app).

### Review Findings

- [x] [Review][Patch] Demo scenarios can overwrite a connected real wallet's persisted state [frontend/src/features/dashboard/riskguard-dashboard.tsx:346] — Fixed by isolating demo scenarios to the deterministic demo wallet and removing browser wallet forwarding from the dashboard demo control.
- [x] [Review][Patch] Testnet mode still renders simulation/demo data as if it belongs to Testnet [frontend/src/features/dashboard/riskguard-dashboard.tsx:145] — Fixed by separating simulation/testnet active wallet loading and filtering simulation events/demo portfolio data out of Testnet mode.
- [x] [Review][Patch] Agent API failures are hidden and health can show "reachable" when unavailable [frontend/src/features/dashboard/riskguard-dashboard.tsx:455] — Fixed by clearing failed read models, surfacing partial API failures, and rendering agent health as unavailable/degraded when reads fail.
- [x] [Review][Patch] Secret redaction misses common snake_case secret keys on the new public audit route [agent/src/api/server.ts:40] — Fixed by expanding redaction patterns for snake_case/kebab-case secret keys in both persisted audit metadata and the public audit response.
- [x] [Review][Patch] Generated `next-env.d.ts` was committed with a dev-only `.next/dev` type import [frontend/next-env.d.ts:3] — Fixed by restoring the build route type import.
