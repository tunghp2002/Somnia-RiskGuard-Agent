# Story 7.6: Redesign Dashboard IA, Telegram Connect, And Public Chain Config

Status: backlog

## Story

As a user,
I want RiskGuard organized as a focused multi-section app with smooth account controls, Telegram Connect, and public chain settings loaded from config,
so that setup and operations feel like a polished web app instead of a single overloaded dashboard.

## Acceptance Criteria

1. Given the user opens the frontend on desktop, when the dashboard renders, then it uses a persistent left sidebar app shell with focused sections for Overview, Setup, Risk, Heartbeat, Rewards, Receipts, Demo, and Health, and the Overview route summarizes status without containing every form and workflow.
2. Given the user opens the frontend on mobile, when the dashboard renders, then primary navigation appears as a bottom navigation bar, and lower-frequency sections are available through a More sheet or menu.
3. Given the user connects, disconnects, signs out, or returns with prior local state, when the account state changes, then the UI shows clear restoring, connected, disconnected, expired, error, and disconnecting states, and wallet-specific dashboard state is cleared on disconnect/sign out.
4. Given the user configures Telegram, when they choose Connect Telegram, then the dashboard starts a bot deep-link, one-time code, QR/link fallback, or equivalent callback flow, and the user is not asked to manually type a Telegram chat id.
5. Given chain metadata is needed by the frontend or agent, when the app reads chain id, public RPC URL, explorer URL, native currency, or public contract addresses, then those values come from `config/public-chains.json`, and environment variables are reserved for secrets and credentials.
6. Given existing UI can be represented by shadcn/ui primitives, when the redesign is implemented, then navigation, account menu, setup forms, dialogs/sheets, tabs, tables, badges, alerts, tooltips, toasts, and loading states use shadcn/ui-style components or local wrappers instead of one-off handcrafted UI.

## Tasks / Subtasks

- [ ] Public chain config (AC: 5)
  - [ ] Add or finalize a typed loader for `config/public-chains.json`.
  - [ ] Update frontend chain/network reads to use public config where applicable.
  - [ ] Update agent runtime/config reads so non-secret chain metadata is not env-only.
  - [ ] Keep env validation for secrets and credentials; clearly label any temporary legacy fallback.
- [ ] App shell and navigation (AC: 1, 2, 6)
  - [ ] Refactor dashboard from one large page into focused route/section components.
  - [ ] Add desktop left sidebar navigation with active route state.
  - [ ] Add mobile bottom navigation and More sheet/menu.
  - [ ] Keep Overview as a status summary, not a mega-screen.
- [ ] Account/session UX (AC: 3, 6)
  - [ ] Add account menu and connection status using shadcn/ui-style primitives.
  - [ ] Handle restoring, connected, disconnected, expired, error, and disconnecting states.
  - [ ] Clear wallet-specific local/dashboard state on disconnect/sign out.
- [ ] Telegram Connect (AC: 4, 6)
  - [ ] Replace manual chat-id setup UI with Connect Telegram.
  - [ ] Support bot deep link, one-time code, QR/link fallback, or equivalent callback flow.
  - [ ] Show waiting, connected, expired, failed, disconnect, and reconnect states.
  - [ ] Keep any direct chat-id path as internal/legacy fallback only, not primary user UX.
- [ ] shadcn/ui adoption pass (AC: 6)
  - [ ] Inspect `frontend/components.json`, `frontend/src/components/ui`, and `frontend/src/lib/utils.ts`.
  - [ ] Use local shadcn/ui-style wrappers for navigation, forms, dialogs/sheets, tabs, tables, badges, alerts, tooltips, toasts, skeletons, and loading/error states where practical.
- [ ] Verification (AC: 1-6)
  - [ ] Run `pnpm --dir frontend lint`.
  - [ ] Run `pnpm --dir frontend build`.
  - [ ] Run `pnpm --dir agent lint`.
  - [ ] Run `pnpm --dir agent test`.
  - [ ] Add or update smoke/manual verification notes for desktop nav, mobile nav, disconnect/sign out, Telegram Connect, and public chain config loading.

## Dev Notes

This story is part of Epic 7 stabilization. It should be implemented after reading:

- `_bmad-output/implementation-artifacts/epic-7-context.md`
- `_bmad-output/implementation-artifacts/spec-full-epic-7.md`
- `_bmad-output/planning-artifacts/ux-design-specification.md`
- `.agents/skills/shadcn-ui-design-system/SKILL.md`

Do not treat this as a marketing redesign. The goal is operational information architecture: focused sections, reliable account state, Telegram connection, public config, and shadcn/ui consistency.

### Key Constraints

- Do not request or store private keys.
- Do not use manual Telegram chat id entry as the main setup path.
- Do not keep piling controls into the existing single dashboard screen.
- Do not move secrets into `config/public-chains.json`.
- Do not silently mix demo data into testnet mode.

### Expected Files / Areas

- `config/public-chains.json`
- `frontend/src/app/*`
- `frontend/src/components/ui/*`
- `frontend/src/features/dashboard/*`
- `frontend/src/features/settings/*`
- `frontend/src/lib/agent-api.ts`
- `frontend/src/lib/wallet.ts`
- `agent/src/config/*`
- `agent/src/api/server.ts`
- `agent/src/integrations/telegram/*`

## Verification

To be completed during implementation.
