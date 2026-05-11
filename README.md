# Somnia RiskGuard Agent

Intelligent on-chain AI Portfolio Guardian Agent on Somnia Agentic L1 with a basic Dead Man's Switch for the Agentathon.

## Current Phase
Phase 1: Setup + Core Foundation.

## MVP Features
- Real-time portfolio monitoring.
- AI-powered Risk Score analysis with Groq primary and DeepSeek fallback.
- Heartbeat Timer and safe Dead Man's Switch.
- Auto claim small staking/LP rewards under configured limits.
- Telegram notifications with quick action buttons.
- Lightweight dashboard for setup and overview.

## Repository Structure
```text
agent/       Node.js + TypeScript agent runtime
frontend/    Next.js 15 App Router dashboard
contracts/   Solidity DeadManSwitch timelock contracts
docs/        Architecture, security, and demo notes
infra/       Deployment and runtime assets
scripts/     Local automation
```

## BMAD Operating Rules
- Work in explicit roles: Orchestrator, Architect, Developer, Tester, QA.
- Every task needs acceptance criteria.
- Use Conventional Commits only.
- Keep `SPECS.md`, `EPIC.md`, `TODO.md`, and `CHANGELOG.md` updated.
- Keep backend and frontend separated.
- Never hardcode secrets; use `.env` based on `.env.example`.

## Setup
No packages are installed yet. Phase 1 next step is to scaffold `/agent`, `/frontend`, and `/contracts` with pinned toolchains.

```bash
cp .env.example .env
```

Fill only local development values. Do not commit `.env`.

## Suggested First Commit
```bash
git init
git add .
git commit -m "chore: initialize bmad project scaffold"
```
