# Somnia RiskGuard Agent - SPECS

## Role
Orchestrator

## Product Goal
Build an intelligent on-chain AI Portfolio Guardian Agent on Somnia Agentic L1 with a basic Dead Man's Switch for the Agentathon MVP.

## MVP Scope
- Real-time portfolio monitoring for configured wallets.
- AI-powered Risk Score analysis using Groq primary and DeepSeek fallback.
- Heartbeat Timer with basic Dead Man's Switch timelock execution path.
- Auto claim small staking/LP rewards when user-configured thresholds pass.
- Telegram notifications with quick action buttons.
- Lightweight dashboard for setup, status, and overview.

## Architecture
- `/agent`: Node.js + TypeScript backend agent.
- `/frontend`: Next.js 15 App Router dashboard with Tailwind and shadcn/ui.
- `/contracts`: Solidity DeadManSwitch timelock contracts and tests.
- `/docs`: product, architecture, and operating notes.
- `/infra`: deployment and runtime configuration assets.
- `/scripts`: local automation scripts.

## Security Requirements
- Never hardcode private keys, bot tokens, RPC keys, API keys, or wallet seeds.
- Load runtime secrets from `.env`; document required variables in `.env.example`.
- Validate all external inputs at process boundaries.
- Default Dead Man's Switch to safe, user-confirmed, timelocked actions.
- Use least-privilege wallet permissions where supported.
- Log operational events without secrets or full private payloads.

## Core Runtime Flow
1. User configures wallet, notification channel, thresholds, and heartbeat interval.
2. Agent monitors portfolio positions, rewards, balances, and risk signals.
3. Agent requests risk analysis from Groq; falls back to DeepSeek on failure.
4. Agent sends Telegram alert with quick actions when risk crosses thresholds.
5. Agent tracks heartbeat expiry and prepares only pre-approved safe actions.
6. Agent claims small rewards only when value and gas rules pass.
7. Dashboard displays status, risk score, recent actions, and heartbeat state.

## Acceptance Criteria
- Repo has separated `/agent`, `/frontend`, and `/contracts` areas.
- All secrets are represented only by `.env.example` placeholders.
- MVP tasks are tracked in `TODO.md` with priority and acceptance criteria.
- Epics are tracked in `EPIC.md`.
- Changes are recorded in `CHANGELOG.md`.
- README explains setup intent, structure, and current phase.

## Non-Goals For MVP
- Full custody or unrestricted trading automation.
- Cross-chain portfolio management.
- Social recovery or multi-sig governance.
- Production mainnet deployment without a dedicated security review.
