# Epic 7 Context: Runtime Integration & MVP Acceptance Hardening

<!-- Created from planning artifacts and the approved dashboard redesign direction. Edit freely. -->

## Goal

Epic 7 turns the implemented slices into a coherent MVP that works through the normal `pnpm dev` path. The product must run scheduled agent behavior, expose browser-visible state, label simulation versus Somnia Testnet honestly, and pass repeatable smoke checks. It also absorbs the dashboard redesign requirements: focused app navigation, smooth auth/disconnect states, Telegram Connect instead of manual chat-id entry, public chain metadata from config, and shadcn/ui-first implementation.

## Stories

- Story 7.1: Run Agent Jobs In Normal Runtime
- Story 7.2: Add Local Runtime Smoke Checks
- Story 7.3: Make Demo/Testnet Capability Honest
- Story 7.4: Wire Or Explicitly Gate Somnia Agent Kit Execution
- Story 7.5: Finish Dashboard Operational UX
- Story 7.6: Redesign Dashboard IA, Telegram Connect, And Public Chain Config

## Requirements & Constraints

The dashboard and agent must behave as one product, not separate demo slices. `pnpm dev` should start the agent API, scheduled jobs, and frontend in a way that can be smoke-tested. Agent health, job outcomes, adapter mode, and secret-safe audit events must be visible enough for operators to trust the demo.

The frontend must not continue as one overloaded page. Desktop must use a persistent left sidebar with focused sections: Overview, Setup, Risk, Heartbeat, Rewards, Receipts, Demo, and Health. Mobile must use bottom navigation for primary sections and a More sheet/menu for lower-frequency sections. Overview summarizes state; detailed forms and diagnostics live in their own sections.

Auth and account handling must feel like a normal web app. Wallet connect, reconnect, disconnect/sign out, session restoration, expired state, API unavailable state, and wallet-specific state clearing must be explicit. The frontend must never request, store, or transmit private keys.

Telegram setup must be a connect flow. Do not ask users to manually type a Telegram chat id. Use a bot deep link, one-time code, QR/link fallback, or equivalent callback flow that binds returned Telegram identity through the agent API. Existing chat-id support can remain only as a legacy/internal fallback, not the primary UX.

Non-secret chain metadata belongs in `config/public-chains.json`: chain id, public RPC URL, explorer URL, native currency metadata, and public contract addresses. Environment variables remain for private keys, bot tokens, LLM keys, and provider credentials.

UI implementation should use shadcn/ui-style primitives or local wrappers wherever practical: sidebar/navigation, mobile bottom nav, account menu, setup forms, dialogs, sheets, tabs, tables, badges, alerts, tooltips, toasts, skeletons, and loading/error states.

## Technical Decisions

Use the local `shadcn-ui-design-system` skill as implementation guidance:

- `{project-root}/.agents/skills/shadcn-ui-design-system/SKILL.md`
- `{project-root}/frontend/components.json`
- `{project-root}/frontend/src/components/ui`
- `{project-root}/frontend/src/lib/utils.ts`
- `{project-root}/config/public-chains.json`

Keep route/feature ownership clear. Reusable UI primitives belong in `frontend/src/components/ui`; product-specific compositions belong in `frontend/src/features/...`; route composition belongs in `frontend/src/app`.

Agent and frontend should share public chain metadata through a typed loader or generated type, not duplicated constants. Runtime config validation should fail closed for missing secrets or invalid public chain config.

## UX & Interaction Patterns

Overview is the command center summary, not the entire application. It should show Guardian Status, active risk/heartbeat/reward state, recent Safety Receipts, and next safe action. Setup owns wallet/Telegram/heartbeat/reward configuration. Risk, Heartbeat, Rewards, Receipts, Demo, and Health each own their detailed workflows.

Every state must be readable without color alone. Use explicit labels for connected, disconnected, restoring, expired, unavailable, adapter-disabled, demo-backed, simulation-backed, and Somnia Testnet-backed states.

Telegram Connect should look and feel like OAuth-style setup: user clicks Connect Telegram, receives a code or opens a bot link, waits for confirmation, then sees connected identity plus disconnect/reconnect actions.

## Cross-Story Dependencies

Story 7.6 affects frontend information architecture and public config loading, so it should be considered before calling Epic 7 complete. It may touch code owned by 7.5, and should preserve acceptance from 7.2 smoke checks and 7.3 demo/testnet truthfulness.
