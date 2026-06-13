# SETUP — SomGuard

> Local development setup: clone → install → configure env → run.
> For Supabase specifics see [local-supabase.md](local-supabase.md); for chain +
> contract metadata see `config/public-chains.json`.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 LTS | Agent + frontend runtimes |
| pnpm | 10.23.0 | `corepack enable` or `npm i -g pnpm` (pinned via `packageManager`) |
| Foundry | latest | `forge` for `contracts/` (`curl -L https://foundry.paradigm.xyz \| bash && foundryup`) |
| Supabase CLI | latest | Optional, for local DB (`winget install Supabase.CLI` / `brew install supabase/tap/supabase`) |

## Install

```bash
git clone <repo-url> Somnia-RiskGuard-Agent
cd Somnia-RiskGuard-Agent
pnpm install          # installs agent + frontend workspaces
pnpm --dir contracts build   # forge build (compiles Solidity)
cp .env.example .env  # then fill local values (see below)
```

## Run

```bash
# Everything in parallel (agent API + jobs, frontend dashboard)
pnpm dev

# Or per surface
pnpm dev:agent        # agent HTTP API on :3001 + polled jobs + Telegram polling
pnpm dev:frontend     # Next.js dashboard on :3000

# Tests
pnpm test             # all workspaces
pnpm test:agent       # vitest
pnpm test:contracts   # forge test

# Build
pnpm build            # recursive build
pnpm smoke:runtime    # node scripts/runtime-smoke.mjs — local runtime smoke check
```

The frontend talks to the agent at `NEXT_PUBLIC_AGENT_API_URL`
(default `http://localhost:3001`). Open the dashboard at `http://localhost:3000`,
connect a browser wallet, and follow setup.

## Environment variables

`.env.example` is the single source of truth for which variables exist. Copy it to
`.env` and fill local values — **never commit `.env`** or any real secret. The
agent validates config at startup with Zod and **fails closed** on invalid values.

### Shared

```bash
NODE_ENV=development
LOG_LEVEL=info
```

### Somnia / EVM

```bash
# Public chain id/RPC/explorer/contracts live in config/public-chains.json.
# To change the runtime chain, update config/public-chains.json.
MONITORED_WALLET_ADDRESS=          # optional pre-configured wallet to monitor
# Public address of the agent's automation/executor wallet. Used as the policy
# signer for safe on-chain actions (reward auto-claim). Unset = those actions
# are blocked at the Somnia execution boundary.
AGENT_WALLET_ADDRESS=
```

### Thirdweb Account Abstraction

```bash
# THIRDWEB_SECRET_KEY is backend-only — never expose it to NEXT_PUBLIC_*.
THIRDWEB_SECRET_KEY=
THIRDWEB_CLIENT_ID=
```

### Supabase encrypted session-key storage

```bash
# For local dev use values from `supabase status` (see local-supabase.md).
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=         # server-side only
# 32-byte key, hex (0x...) or base64. Generate once and keep stable.
SESSION_KEY_ENCRYPTION_KEY=
```

### Risk engine

Risk decisions come from the on-chain Somnia risk agent (see the Somnia Agent
Platform section); there is no off-chain LLM provider. Only the alert threshold is
configured here.

```bash
RISK_SCORE_ALERT_THRESHOLD=70      # 0–100; threshold used by risk snapshots / demo
```

### Heartbeat / smart-account inheritance

```bash
HEARTBEAT_INTERVAL_SECONDS=86400
HEARTBEAT_GRACE_SECONDS=3600
# Contract addresses — optional env overrides for config/public-chains.json.
INHERITANCE_REGISTRY_CONTRACT_ADDRESS=
RISK_GUARD_APPROVAL_STORE_ADDRESS=
RISK_GUARD_HOOK_MODULE_ADDRESS=
RISK_GUARD_VALIDATOR_MODULE_ADDRESS=
RISK_GUARD_MODULAR_ACCOUNT_FACTORY_ADDRESS=
RISK_GUARD_DEFAULT_VALIDATOR_ADDRESS=
```

### Somnia Agent Platform

```bash
# Agent IDs and platform/requester addresses are public contract configuration.
# WALLET_DEPLOYER_PRIVATE_KEY is the sensitive value — never commit a real key.
SOMNIA_AGENT_REQUESTER_ADDRESS=
RISK_GUARD_RISK_ASSESSMENT_AGENT_ID=
INHERITANCE_HEARTBEAT_AGENT_ID=
INHERITANCE_DISTRIBUTION_AGENT_ID=
RISK_GUARD_AGENT_REWARD_PER_CALL_STT=0.1
INHERITANCE_AGENT_REWARD_PER_CALL_STT=0.1
```

### Approval Risk Scanner (revoke.cash-style tab)

```bash
# Deployed ApprovalRiskScanner address (also accepted via
# config/public-chains.json → somnia-*.contracts.approvalRiskScanner).
APPROVAL_SCANNER_CONTRACT_ADDRESS=
# Agent IDs from the Somnia Agent Explorer (agents.somnia.network). The LLM
# inference id falls back to RISK_GUARD_RISK_ASSESSMENT_AGENT_ID if unset.
APPROVAL_SCANNER_JSON_API_AGENT_ID=
APPROVAL_SCANNER_PARSE_WEBSITE_AGENT_ID=
APPROVAL_SCANNER_LLM_INFERENCE_AGENT_ID=
APPROVAL_SCANNER_AGENT_REWARD_PER_CALL_STT=0.1
```

> Chains the scanner can discover approvals on live in `config/public-chains.json`
> → `scanChains[]` (each needs `rpcUrl` + a Blockscout `explorerApiBaseUrl`;
> Somnia mainnet is `priority: 0`). The scanner **contract** runs on Somnia only.
> Until the agent IDs + address are set, the Allowances tab can list approvals but
> `prepare`/`analyze` returns `scanner_not_configured`.

### Reward claiming

```bash
AUTO_CLAIM_ENABLED=false
MAX_CLAIM_GAS_USD=1
MIN_REWARD_VALUE_USD=2
```

### Telegram

```bash
# Users connect Telegram through the dashboard/bot flow — do not type chat id manually.
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
```

### Frontend (`NEXT_PUBLIC_*`)

```bash
NEXT_PUBLIC_AGENT_API_URL=http://localhost:3001
NEXT_PUBLIC_THIRDWEB_CLIENT_ID=
# NEXT_PUBLIC_AGENT_API_BASE_URL=http://localhost:3001
# NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=
```

> **RULE-11**: any new env var must be added to `.env.example` **and** this
> SETUP.md (and `DEPLOY.md` once a production runbook exists) in the same commit.

## Local Supabase

The backend uses the Supabase service role key server-side only; `anon` /
`authenticated` roles have no direct table access, so browser calls must go
through the agent API. Quick path:

```bash
supabase init
supabase start                       # prints local URL + service_role key
# Run infra/supabase/setup.sql in the SQL editor to create tables
```

Copy the printed `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` into `.env`. Full
steps in [local-supabase.md](local-supabase.md).

## Contracts: deploy + agent wiring

```bash
pnpm --dir contracts build
pnpm --dir contracts test
# After deploying, register Somnia agent platform + agent IDs
# (RiskGuard, Inheritance, and the ApprovalRiskScanner):
pnpm --dir contracts configure:agents   # needs WALLET_DEPLOYER_PRIVATE_KEY + agent IDs
```

Deployed Somnia Testnet addresses are tracked in `config/public-chains.json` and
`contracts/README.md`.
