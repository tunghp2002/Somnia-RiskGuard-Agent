# Somnia RiskGuard Agent - EPIC

## Epic 1: Project Foundation
Status: In Progress

Goal: Establish secure monorepo structure, shared conventions, environment contract, and BMAD operating files.

Acceptance Criteria:
- Folder boundaries exist for agent, frontend, contracts, docs, infra, and scripts.
- `SPECS.md`, `EPIC.md`, `TODO.md`, `CHANGELOG.md`, `.env.example`, and `README.md` exist.
- Initial Phase 1 task list is prioritized and efforted.

## Epic 2: Agent Core
Status: Planned

Goal: Implement the TypeScript agent runtime for wallet monitoring, risk analysis, heartbeat tracking, reward claims, and notifications.

Acceptance Criteria:
- Agent boots with validated env config.
- Portfolio monitor reads Somnia wallet state.
- Risk service calls Groq and falls back to DeepSeek.
- Telegram service sends alerts with quick action buttons.
- Reward claimer enforces configured limits.

## Epic 3: Dead Man's Switch Contract
Status: Planned

Goal: Implement a safe Solidity timelock contract for pre-approved fallback actions.

Acceptance Criteria:
- Contract supports owner heartbeat renewal.
- Expired heartbeat exposes safe execution path only.
- Tests cover heartbeat renew, expiry, execution, and unauthorized access.

## Epic 4: Dashboard
Status: Planned

Goal: Build a lightweight Next.js dashboard for setup and operational overview.

Acceptance Criteria:
- Setup form validates wallet, thresholds, notification settings, and heartbeat.
- Overview shows risk score, portfolio status, heartbeat timer, and recent actions.
- UI uses Tailwind and shadcn/ui conventions.

## Epic 5: Integration And Demo Readiness
Status: Planned

Goal: Connect all surfaces into a reliable Agentathon demo path.

Acceptance Criteria:
- End-to-end local demo flow is documented.
- Testnet configuration is separated from local defaults.
- Demo avoids real high-value transactions.
