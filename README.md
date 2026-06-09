# SomGuard

An on-chain AI portfolio guardian for the **Somnia Agentic L1**. RiskGuard is an
active smart-account guard, not a passive scorer: risky transactions are blocked
at validation time by an **ERC-7579 validator module** and only proceed after an
off-chain agent review (optionally confirmed by the user in Telegram) records a
short-lived on-chain approval. It also runs a non-custodial, heartbeat-driven
**smart-account inheritance** ("dead man's switch") enforced by Somnia Native
On-Chain Reactivity and consensus-validated Somnia Agents. Built for the
Agentathon.

## What it does

- **RiskGuard transaction guard** — an ERC-7579 validator on a Thirdweb modular
  smart account blocks risky native transfers, contract calls, approvals, and
  batches with a `PendingApprovalRequired` revert until an agent/Telegram
  approval is recorded.
- **AI risk review (on-chain agent)** — risky transactions are reviewed by a
  consensus-validated Somnia risk agent (on-chain LLM Inference) that returns an
  APPROVE/REJECT decision. There is no off-chain LLM; the agent's decision never
  directly authorizes a transaction — the validator + a signature do.
- **Approval Risk Scanner (revoke.cash-style)** — the **Allowances** tab lists
  every contract a wallet approved as a token spender (discovered off-chain from
  the chain's Blockscout-compatible explorer API — indexed `getLogs`), then a
  single signed `requestScan` tx on Somnia rates each approval (token + spender) as
  **LOW / MEDIUM / HIGH** risk using **all three Somnia base agents**: JSON API
  Request (explorer facts) + LLM Parse Website (explorer-page red flags) → LLM
  Inference (combined verdict). The dashboard shows the risk **level** per approval.
  Read-only discovery; the `requestScan` tx pays the agent deposits (unused escrow
  is refundable). Multi-chain select, Somnia prioritized.
- **Smart-account inheritance** — one non-custodial plan per smart account
  (beneficiaries by share, protected assets, heartbeat/grace/timelock). Creating a
  plan takes a **single wallet signature**: one ERC-7579 batch installs the
  registry as the account's executor module, funds the agent budget, and writes the
  plan in one UserOp. Distribution is scheduled on-chain via Reactivity and approved
  by a Somnia agent, with a manual fallback.
- **Telegram alerts + signed quick actions** — risk alerts and approve/refresh
  buttons with HMAC-signed, nonce-protected callbacks. Enabling RiskGuard and
  creating an inheritance plan require a linked Telegram first, so alerts and
  heartbeat reminders always have a delivery channel.
- **Bounded auto-claim** — small staking/LP reward claims under configured
  value/gas policies.
- **Dashboard** — wallet connect, RiskGuard policy config, native transfers,
  approval risk scanning, inheritance planning, profile + Telegram connect,
  portfolio/risk overview.

## Repository structure

```text
agent/       Node.js + TypeScript agent runtime (HTTP API, jobs, services, policies)
frontend/    Next.js 16 App Router dashboard (thirdweb AA, ethers v6)
contracts/   Solidity + Foundry: RiskGuard ERC-7579 modules + inheritance registry
config/      public-chains.json — non-secret chain + contract metadata (source of truth)
docs/        Architecture, context (decisions), setup, and domain notes
infra/       Supabase SQL and runtime assets
scripts/     Local automation (runtime smoke check)
```

## Tech stack

pnpm monorepo · TypeScript · Next.js 16 / React 19 · Tailwind + shadcn/ui ·
thirdweb v5 (ERC-4337/7579 AA) · ethers v6 · zod · pino ·
somnia-agent-kit (on-chain Somnia risk agent) · Supabase (+ JSON-store fallback) ·
Solidity 0.8.35 / Foundry ·
OpenZeppelin 5.6 · Somnia Testnet (chainId 50312).

## Quick start

```bash
pnpm install
cp .env.example .env     # fill local values
pnpm dev                 # agent API (:3001) + dashboard (:3000)
```

Full setup, env vars, Supabase, and contract deploy steps: [docs/SETUP.md](docs/SETUP.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture, components, data + API, security.
- [docs/CONTEXT.md](docs/CONTEXT.md) — decision log (why the design is what it is).
- [docs/SETUP.md](docs/SETUP.md) — local development setup and environment variables.
- [CHANGELOG.md](CHANGELOG.md) — release history.
- [docs/riskguard-validation-module.md](docs/riskguard-validation-module.md) — the active-guard design.
- [docs/somnia-agent-reactivity-context.md](docs/somnia-agent-reactivity-context.md) — Somnia agents + Reactivity notes.
- [contracts/README.md](contracts/README.md) — contract toolchain, deployments, approval flow.
- `_bmad-output/` — BMAD planning + implementation artifacts (PRD, architecture, epics, stories).

## Operating conventions

- Backend and frontend stay separated; the frontend never holds private keys.
- LLM output is advisory; every state-changing action passes a deterministic
  policy gate and records signer, chain ID, target, and calldata summary.
- Secrets live in `.env` only (based on `.env.example`); non-secret chain
  metadata lives in `config/public-chains.json`.
- Conventional Commits (`feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`test:`).
