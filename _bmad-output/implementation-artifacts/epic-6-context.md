# Epic 6 Context: Dashboard, Demo Mode & Operator Visibility

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 6 delivers the visible product surface for Somnia RiskGuard Agent: a responsive dashboard where users and judges can see wallet/setup readiness, portfolio and risk state, heartbeat and Dead Man's Switch protection, reward automation, recent safety decisions, subsystem health, and deterministic demo scenarios. It matters because the backend agent, contract, Telegram, and policy work only becomes legible when the user can understand status, configure MVP settings, and see why the agent acted or refused.

## Stories

- Story 6.1: Build Dashboard Shell And Wallet Connection
- Story 6.2: Add Configuration Forms For MVP Settings
- Story 6.3: Display Portfolio, Risk, Heartbeat, And Recent Actions
- Story 6.4: Add Deterministic Demo Scenario Controls
- Story 6.5: Show Operator Health And Secret-Safe Logs

## Requirements & Constraints

The dashboard must expose setup state, portfolio overview, Risk Score, heartbeat status, recent actions, health checks, and deterministic demo controls. Users must be able to connect a browser wallet, see wallet address and network state, and never enter or store a private key. Dashboard configuration should cover risk threshold, Telegram binding, heartbeat/beneficiary settings, and reward claim policy values by calling the agent API and surfacing backend validation errors.

The UI must distinguish simulated/demo behavior from Somnia Testnet-backed behavior. It must not silently mix testnet and simulation states. Demo scenarios should be deterministic and judge-friendly for risk alerts, reward claims, heartbeat expiry, and Dead Man's Switch timelock visibility.

Operator views must show subsystem health for monitoring, LLM providers, Telegram, RPC, signer, contracts, and persistence where available. Logs and recent actions must be secret-safe: enough context to identify failing subsystem or policy decision, but no private keys, tokens, credentials, or sensitive payloads.

The frontend owns setup and overview only. It must call the agent REST API rather than duplicating monitoring, persistence, execution, or contract logic. Browser wallet identity remains separate from the backend agent wallet.

## Technical Decisions

The frontend is a Next.js App Router dashboard in `/frontend`, using TypeScript, Tailwind, and a shadcn/ui-style component approach. Domain UI should live under `frontend/src/features`, shared API and wallet helpers under `frontend/src/lib`, and routes under `frontend/src/app`.

The agent API is the dashboard's source of truth for readiness, portfolio snapshots, risk snapshots, Telegram binding, heartbeat settings/status, reward settings/status, policy checks, and health. Any demo controls should either call existing API routes or use deterministic frontend-local demo state when backend simulation endpoints do not exist, but the UI must label the mode clearly.

Root pnpm scripts should continue to build frontend, agent, and contracts separately. Frontend verification should use `pnpm --dir frontend build`; add lint/type checks or tests only if the existing frontend package supports them.

## UX & Interaction Patterns

Use the Guardian Command Center as the primary dashboard direction. The first screen should show Guardian Status, Risk Score, heartbeat timer, Dead Man's Switch state, reward policy, wallet role chips, environment/mode badges, and recent Safety Receipts. The design should be dark-mode first with first-class light mode support: deep neutral surfaces, electric purple as controlled premium accent, cyan/teal for active monitoring, and semantic red/amber/green for risk and state.

Custom UX concepts that matter for implementation are Guardian Status Panel, Risk Score Circle, Wallet Role Chip, Safety Receipt, Heartbeat Timer, Dead Man's Switch Status, Reward Policy Summary, Demo Scenario Control, Safety Timeline, and Subsystem Health Row. Every skipped, denied, failed, pending, and successful outcome should be treated as a first-class receipt with plain-language reason.

Desktop is the primary surface for setup, demo, and operator workflows. Mobile should prioritize Guardian Status, one safe next action, recent receipt, and beneficiary clarity. Accessibility target is WCAG 2.2 AA: state labels must not rely on color alone, controls need visible focus states, long wallet/hash values should be truncated but copyable, and deadline/timelock states should include exact timestamps.

## Cross-Story Dependencies

The dashboard shell and wallet helper enable all later forms and views. Configuration forms feed readiness and status panels. Overview depends on existing portfolio, risk, heartbeat, reward, and audit/health data. Demo controls and operator health should reuse the same Safety Receipt and mode-labeling patterns so judges can follow the complete setup -> monitoring -> risk -> Telegram -> reward -> DMS story without terminal logs.
