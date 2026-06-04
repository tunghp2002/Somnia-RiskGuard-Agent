---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/prd-validation-report.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-06-04'
project_name: 'SomGuard'
user_name: 'tug'
date: '2026-06-04'
revisionNote: 'Revised 2026-06-04 to match the shipped v0.1.0 codebase (active ERC-7579 guard pivot, Supabase persistence, thirdweb AA, Reactivity-driven inheritance). Canonical living docs are docs/ARCHITECTURE.md and docs/CONTEXT.md.'
---

# Architecture Decision Document

_This document was originally drafted during planning (2026-05-10) and has been
rewritten in place on 2026-06-04 to reflect the actually shipped system. Where
this document and the living docs disagree, the living docs win:
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) (current system) and
[`docs/CONTEXT.md`](../../docs/CONTEXT.md) (append-only decision log, AD/D IDs)._

### Revision note (2026-06-04)

The planning-era architecture described a passive "Dead Man's Switch contract"
with LLM portfolio *scoring* as the central feature. The product pivoted during
implementation. Key changes captured in this revision:

- **Active ERC-7579 smart-account guard (AD-4 / D4).** RiskGuard is no longer a
  scoring side-channel. `RiskGuardValidator` (ERC-7579 module type 1) enforces a
  deterministic risk policy inside `validateUserOp` and **blocks** risky
  UserOps with a `PendingApprovalRequired` revert. Execution resumes only after
  a short-lived approval is recorded on-chain in `RiskGuardApprovalStore`
  (10-minute TTL, one-time use) — either by a Telegram-confirmed user or by a
  consensus Somnia risk agent (`requestAgentReview` / `handleRiskAssessmentResponse`).
  An experimental `RiskGuardHookModule` (type 4) carries the same policy but is
  inactive (Thirdweb's ModularAccount does not run hooks on its primary execute
  path). Risk intelligence comes from the on-chain Somnia risk agent review,
  which is advisory/decisional (APPROVE/REJECT) but never directly authorizes a
  transaction (AD-2).
- **Off-chain LLM risk scoring removed (AD-2 / D11).** The planning-era off-chain
  LLM risk-scoring path (a primary provider with a fallback provider) was deleted
  in favor of the on-chain Somnia risk agent review. Portfolio monitoring still
  runs (change
  detection + snapshot persistence + audit), but with no off-chain LLM step; risk
  snapshots now originate only from demo scenarios (`provider: "demo" | "none"`)
  and the on-chain agent review decision.
- **Dual persistence, not "JSON files only" (AD-8 / D8).** A single
  `RepositoryStore<T>` contract has two implementations: `SupabaseJsonStore`
  (Supabase Postgres REST — `agent_records`, `users`, `session_keys`) and
  `JsonStore` (file-backed, local/dev/test). Session keys are AES-encrypted at
  rest via `SESSION_KEY_ENCRYPTION_KEY`.
- **thirdweb account abstraction (AD-7 / D7).** The dashboard is Next.js 16 /
  React 19 using thirdweb v5 for an ERC-4337/7579 modular smart account with gas
  sponsorship; the agent stays on ethers v6 for reads/writes/signing.
- **Reactivity-driven, non-custodial inheritance (AD-5, AD-6 / D5, D6).**
  `RiskGuardInheritanceRegistry` stores policy only — funds remain in the user's
  smart account. Distribution is scheduled via Somnia Native On-Chain Reactivity
  (precompile `0x0100`) and approved by consensus Somnia Agents, with a manual
  `executeInheritance` fallback. EOAs cannot create plans.
- **Jobs use `setInterval`, not `node-cron`.**
- **Uniform API envelope** `{ ok, data | error, requestId }`, not `{ data, meta }`.

The remainder of this document has been updated so every statement is true of
the current code; the original planning rationale is retained where it still
holds.

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
SomGuard is an on-chain AI portfolio guardian for the Somnia
Agentic L1. It requires a separated multi-surface architecture supporting wallet
setup on a smart account, portfolio monitoring, an on-chain Somnia risk agent
review for risky transactions, Telegram alerting with authenticated quick actions, an **active
on-chain risk guard** that blocks risky transactions until approved, heartbeat
tracking, non-custodial inheritance ("dead man's switch") state and execution,
constrained reward claiming, dashboard visibility, demo simulation, and
audit-friendly operations.

These requirements map to three runtime surfaces plus demo tooling: a backend
**agent runtime** for monitoring/execution/approval coordination, a **Next.js
dashboard** for setup, transfers, inheritance planning, and Telegram connect, and
**Solidity contracts** for the ERC-7579 guard and the inheritance registry.
Deterministic demo flows remain a requirement for Agentathon judging.

**Non-Functional Requirements:**
The strongest drivers are **security**, **non-custody**, **auditability**, and
**reliability**. The on-chain Somnia risk agent review is advisory/decisional and
never directly authorizes a transaction; execution authority lives in
deterministic policy gates plus on-chain validation. User
funds stay in the user's smart account; contracts hold policy/state only. The
browser never holds private keys; the agent signer and session keys live in
env/Supabase (encrypted). Telegram quick actions require HMAC signing, nonce, and
TTL replay protection. Every state-changing attempt records signer, chain ID,
target, calldata summary, and outcome. Performance targets remain demo-oriented
(agent review surfaced within ~15s, Telegram alert within ~15s, dashboard setup
within ~3 min).

**Scale & Complexity:**

- Primary domain: full-stack Web3 AI agent on an account-abstracted smart account
- Complexity level: high
- Estimated architectural components: 8 core components

Core components:
- Next.js dashboard (thirdweb AA, transfers, inheritance, profile/Telegram)
- Backend agent runtime (HTTP API + jobs + services)
- Portfolio monitor + on-chain Somnia risk agent review
- Telegram notification/action service (signed callbacks)
- ERC-7579 RiskGuard validator/hook + approval store (active guard)
- Non-custodial inheritance registry (Reactivity + consensus agents)
- Dual persistence (Supabase REST + JSON store) over typed repositories
- Demo/simulation and audit/observability layer

### Technical Constraints & Dependencies

The architecture respects the repository's surface boundaries:

- `/agent`: Node.js + TypeScript (NodeNext ESM) backend agent — HTTP API, jobs,
  services, policies, integrations, persistence.
- `/frontend`: Next.js 16 App Router dashboard (React 19, thirdweb v5,
  Tailwind 4 + shadcn/ui).
- `/contracts`: Solidity 0.8.35 + Foundry — ERC-7579 RiskGuard modules,
  approval store, inheritance registry, Somnia agent interfaces.
- thirdweb v5 for ERC-4337/7579 smart-account UX and gas sponsorship (frontend).
- `ethers` v6 for backend contract reads/writes, event polling, and signing.
- Somnia risk agent (on-chain LLM Inference) for risky-transaction review via
  `RiskGuardValidator.requestAgentReview` / `handleRiskAssessmentResponse`; no
  off-chain LLM provider.
- Telegram Bot API for alerts and signed quick actions.
- Somnia AgentRequester (consensus agents) and Somnia Native On-Chain Reactivity
  (precompile `0x0100`) for inheritance liveness/distribution.
- Supabase (Postgres REST) for durable records + encrypted session keys, with a
  JSON file store for local/dev/test.
- Blockscout (Shannon explorer) for token/NFT enumeration.
- Somnia Testnet (chainId 50312, native STT); non-secret chain/contract metadata
  in committed `config/public-chains.json`.

Secrets (agent signer key, `SESSION_KEY_ENCRYPTION_KEY`, Telegram bot token,
Supabase service-role key, thirdweb secret key) are environment-only and never
persisted or logged (pino redaction).

### Cross-Cutting Concerns Identified

- Secret management and fail-closed startup configuration validation (Zod).
- On-chain risk enforcement in bounded ERC-4337 validation (no sync external
  calls inside `validateUserOp`).
- Short-lived, one-time approval lifecycle (TTL + consume-once).
- On-chain agent review isolation from execution authority (its APPROVE/REJECT
  never directly authorizes a transaction).
- Telegram action authentication and replay prevention (HMAC + nonce + TTL).
- Dead-man's-switch false-trigger prevention via on-chain expiry + timelock.
- Non-custodial smart-account distribution authority and beneficiary timelocks.
- Smart-contract access control (precompile/platform-gated handler entrypoints).
- Audit-friendly logs without secret leakage.
- Provider failure handling for Telegram, RPC, Supabase, Blockscout, and Somnia
  agents.
- Clear separation of simulated demo behavior from Somnia Testnet behavior.
- Beneficiary-safe UX for non-technical users.

## Starter Template Evaluation

### Primary Technology Domain

A full-stack Web3 AI agent with three implementation workspaces (`/agent`,
`/frontend`, `/contracts`). A single full-stack starter is a poor fit; the
shipped solution uses a root pnpm workspace with focused per-surface tooling.

### Starter Options Considered

**Option 1: Single Next.js/shadcn monorepo starter** — fast dashboard, but does
not model the long-running agent runtime or the Foundry contract workspace.

**Option 2: Hardhat + custom Node/Next** — viable, but Foundry was preferred for
fast Solidity-first iteration, Anvil simulation, and concise tests.

**Option 3 (selected): Foundry contracts + root pnpm workspace** — pnpm is the
single JS/TS package manager; `/agent`, `/frontend`, `/contracts` are workspaces;
Foundry owns Solidity build/test/script.

### Selected Starter: pnpm Workspace + Focused Surface Starters

**Rationale:** Preserves the explicit `/agent` · `/frontend` · `/contracts`
boundary, gives one package manager and script surface, and lets Foundry own the
contract toolchain. (AD-1 / D1.)

**Architectural Decisions Provided by the Starter (as shipped):**

- **Package management:** pnpm 10.x workspace; root scripts delegate per surface.
- **Language & runtime:** TypeScript across agent + frontend; Solidity 0.8.35 for
  contracts; Node.js agent runtime; Foundry (`via_ir`, 200 runs) for contracts.
- **Frontend:** Next.js 16.2 App Router + React 19.2, Tailwind 4 + shadcn/ui
  (New York), thirdweb v5 for ERC-4337/7579 smart-account connection, gas
  sponsorship, and connect UX.
- **Agent dependencies (actual):** `zod` (validation), `pino` (logs), `ethers`
  v6 (EVM), `somnia-agent-kit` (3.0.x), Supabase REST client, native Node `http`
  for the API server, and `vitest` for tests. Scheduling uses native
  `setInterval` rather than `node-cron`. (The planning doc's `node-cron`/`viem`
  assumptions did not survive implementation.)
- **Account abstraction:** thirdweb owns frontend smart-account UX
  (`createThirdwebAccountAbstraction`, deterministic `riskGuardAccountSalt`,
  `sponsorGas`); the agent stays on ethers. `@somnia-chain/reactivity` /
  precompile ABI is reserved for scheduling, not wallet UX. (AD-7 / D7.)
- **Testing:** Vitest for agent unit/policy/service tests; Foundry Solidity tests
  for guard + inheritance behavior.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (shipped):**
- RiskGuard is an **active** ERC-7579 validator that blocks risky UserOps and
  requires a recorded approval before execution (AD-4).
- LLM output is advisory only; it never authorizes a transaction (AD-2).
- Every state-changing agent action passes a deterministic policy gate before
  signing (AD-3).
- Inheritance is **non-custodial**: funds stay in the user's smart account;
  distribution executes from the account, scheduled by Reactivity and approved by
  consensus agents (AD-5, AD-6).
- Frontend never stores or receives private keys; agent signer + session keys are
  env/Supabase-encrypted.
- MVP targets Somnia Testnet plus explicit demo scenarios.

**Important Decisions (shipped):**
- `somnia-agent-kit` is the SDK boundary for portfolio/reward/approval tool calls.
- Dual persistence: Supabase REST in deployed mode, JSON store for local/dev
  (AD-8).
- ethers v6 is the agent's EVM library; thirdweb is the frontend AA library
  (AD-7).
- Telegram uses long-polling with signed callbacks (AD-9).
- `config/public-chains.json` is the chain/contract metadata source of truth
  (AD-10).

**Deferred Decisions (post-MVP):**
- Activate the hook module once a ModularAccount variant runs hooks on the
  primary execute path.
- Production database migration beyond Supabase REST + JSON store.
- Telegram webhook deployment.
- Multi-chain support; external audit before mainnet/high-value usage.

### Tech Stack (as shipped)

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Monorepo | pnpm workspace | 10.x | One manager; `/agent`, `/frontend`, `/contracts` |
| Agent runtime | Node.js + TypeScript | NodeNext ESM | Long-running monitor + HTTP API |
| Agent HTTP | Node `http` (native) | — | Manual router + Zod; `{ ok, data, requestId }` |
| EVM (agent) | ethers | 6.16 | Reads/writes, signing, event polling |
| Validation | zod | 4.x | Env, payloads, persisted shapes, policy decisions |
| Logging | pino | 10.x | Structured, secret-redacting logs |
| Risk intelligence | Somnia risk agent (on-chain LLM Inference) | — | Risky txs reviewed by a consensus Somnia agent returning APPROVE/REJECT; no off-chain LLM provider |
| Somnia SDK | somnia-agent-kit | 3.0.x | Portfolio/reward/approval tool calls |
| Persistence | Supabase REST + JSON store | — | Dual `RepositoryStore<T>` |
| Frontend | Next.js + React | 16.2 / 19.2 | Client-rich dashboard, no SSR data path |
| Wallet / AA | thirdweb | 5.x | ERC-4337/7579 modular account, gas sponsorship |
| Styling | Tailwind + shadcn/ui | Tailwind 4 | App shell, panels, forms |
| Explorer data | Blockscout (Shannon) | — | Token/NFT enumeration |
| Contracts | Solidity + Foundry | 0.8.35, via_ir, 200 | Fast iteration + Anvil |
| Contract libs | OpenZeppelin | 5.6.1 | ReentrancyGuard, SafeERC20, ERC ifaces |
| Chain | Somnia Testnet | 50312 | STT native; `public-chains.json` is SoT |

### Data Architecture

State persists through typed repositories over two interchangeable stores sharing
the same `RepositoryStore<T>` contract:

- **`SupabaseJsonStore`** (`agent/src/persistence/supabase-json-store.ts`) — REST
  over Supabase; collection records in `agent_records` (collection + JSONB,
  upsert-on-write). `users` and `session_keys` use dedicated tables via their
  repositories.
- **`JsonStore`** (`agent/src/persistence/json-store.ts`) — file-backed
  (`agent/src/persistence/data/*.json`) with a write queue; local/dev/test.

| Repository | Stores |
|-----------|--------|
| `users` | wallet address + display name |
| `session-keys` | AES-encrypted session keys for smart-account actions |
| `audit-events` | append-only `{ eventType, status, metadata, createdAt }` |
| `portfolio-snapshots` | assets, USD value, rewards, risk signals per wallet |
| `risk-snapshots` | risk snapshots (demo scenarios / on-chain agent review) + thresholds |
| `reward-claims` | reward settings, fixtures, claim history |
| `heartbeats` | heartbeat config/state per wallet + beneficiary |
| `telegram-bindings` | wallet → chatId binding + metadata |
| `action-nonces` | nonce tracking for replay prevention |
| `alerts` | risk alert records |

Private keys never enter application state; the agent signer key and
`SESSION_KEY_ENCRYPTION_KEY` are env-only. Non-secret chain/contract metadata is
committed in `config/public-chains.json`. Risk scores are integers `0-100`;
wallet addresses are checksum-normalized before persistence; on-chain bigints
serialize as decimal strings.

### Authentication & Security

- Dashboard auth: browser wallet connection + signed-message proof for protected
  mutations.
- Agent signer: dedicated env-loaded executor wallet bounded by deterministic
  policy gates; session keys (encrypted in Supabase) sign bounded smart-account
  actions and approval submissions.
- Telegram quick actions: HMAC-SHA256 signed callbacks with nonce + TTL and
  wallet↔chat binding; replays/forgeries fail closed.
- The on-chain Somnia risk agent review (APPROVE/REJECT) cannot directly
  authorize a transaction; execution still requires the validator's approval
  check plus a user/agent signature.
- `somnia-agent-kit` tool calls are wrapped by local policy checks before any
  state-changing action.
- Risk enforcement happens on-chain in `validateUserOp` (no synchronous
  external/LLM/Telegram/API calls inside validation); approval is recorded
  on-chain with a 10-minute TTL and consumed once.
- Dead-man's-switch activation requires on-chain expiry + timelock, not off-chain
  judgement; distribution is non-custodial.

### API & Communication Patterns

- The agent exposes a native-`http` REST JSON API (base path `/api`) for the
  dashboard and Telegram callbacks. **All responses use the uniform envelope**
  `{ ok, data | error, requestId }` — success `{ ok: true, data, requestId }`,
  failure `{ ok: false, error: { code, message, ... }, requestId }`. (This
  supersedes the planning-era `{ data, meta }` shape.)
- Boundary errors map to status codes (ZodError/AddressValidationError → 400,
  payload too large → 413, dependency errors → 500).
- The dashboard calls the agent API; it does not duplicate monitoring/execution.
- `somnia-agent-kit` is used inside the service layer for tool calling and
  Somnia-specific chain interactions.
- Telegram uses long-polling (`getUpdates`); webhook deferred.

### Frontend Architecture

Next.js App Router app under `frontend/src/app/`. `page.tsx` renders
`ThirdwebAppProvider` → `RiskGuardDashboard`. Client-rich, no SSR data path.
Dashboard sections are driven by `use-riskguard-dashboard.ts`:

- **overview** — Blockscout asset enumeration + RiskGuard policy/module status.
- **transfer** — native STT send from EOA or smart account, with gas estimate and
  agent-review handling (`agent-review-modal.tsx`).
- **inheritance** — non-custodial plan builder (`features/settings/*`).
- **profile** — display name + Telegram connect.

Key libs (`frontend/src/lib/`): `thirdweb-client.ts` (smart-account/chain/AA
setup, `createThirdwebAccountAbstraction`, deterministic `riskGuardAccountSalt`),
`riskguard-module.ts` (module install + policy config), `inheritance-registry.ts`
(registry contract calls), `native-transfer.ts`, `agent-api.ts` (backend REST
client), `blockscout-api.ts` (asset enumeration), `wallet.ts` (browser wallet).
UI primitives are shadcn (button, input, badge, tooltip, sonner). Env consumed:
`NEXT_PUBLIC_THIRDWEB_CLIENT_ID`, `NEXT_PUBLIC_AGENT_API_URL`/`_BASE_URL`,
`NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, `NEXT_PUBLIC_APP_NAME`.

### Infrastructure & Deployment

- Root pnpm workspace orchestrates scripts for agent, frontend, contracts.
- Foundry handles contract build/test/deploy; post-deploy agent wiring via
  `pnpm --dir contracts configure:agents`.
- CI runs agent tests, frontend build/lint, and Foundry tests separately.
- Demo scenarios are explicit and never silently target Somnia Testnet.
- Production/mainnet requires external audit; MVP target is internal review +
  automated tests.

### Component Diagram

```mermaid
flowchart LR
  User[User Wallet Browser] --> Frontend[Next.js 16 Dashboard\nthirdweb v5 AA / ethers v6 / Blockscout]
  Frontend -->|REST NEXT_PUBLIC_AGENT_API_URL| AgentAPI[Agent HTTP API\nnative http, Zod, { ok, data, requestId }]
  Telegram[Telegram Bot] <-->|polling + signed callbacks| AgentAPI

  subgraph Agent["/agent Node.js TypeScript"]
    AgentAPI --> Services[Services\nportfolio, heartbeat,\nreward-claim, telegram-*, session-key,\nriskguard-approval, setup, audit, demo]
    AgentAPI --> Jobs[Jobs setInterval\nportfolio-monitor 30s · heartbeat 60s\nreward-claim 60s · riskguard-review 15s]
    Jobs --> Services
    Services --> Policies[Policies pure\nexecution / deadman / reward-claim]
    Policies --> Integrations[Integrations\ntelegram · somnia-agent-kit\ninheritance-registry]
    Services --> Persistence[Persistence RepositoryStore]
    Jobs --> Persistence
  end

  Persistence --> Supabase[(Supabase REST\nagent_records / users / session_keys)]
  Persistence --> JsonStore[(JSON store local/dev)]
  Integrations -->|ethers v6| EVM[Somnia Testnet RPC 50312]

  subgraph Chain["Somnia Testnet"]
    EVM --> ModularAccount[Thirdweb ModularAccount + Factory\n+ DefaultValidator]
    ModularAccount --> Validator[RiskGuardValidator ERC-7579 t1\nvalidateUserOp -> PendingApprovalRequired]
    ModularAccount -. experimental .-> Hook[RiskGuardHookModule ERC-7579 t4]
    Validator --> ApprovalStore[RiskGuardApprovalStore\n10-min TTL, consume-once]
    Validator --> AgentReq[Somnia AgentRequester\nrequestAgentReview / handleResponse]
    EVM --> Registry[RiskGuardInheritanceRegistry\nnon-custodial policy + distribution]
    Registry --> Reactivity[Reactivity precompile 0x0100\nSchedule at timelockEndsAt]
    Registry --> AgentReq
  end
```

### Decision Impact Analysis

**Cross-Component Dependencies:**
- Dashboard setup depends on agent API schemas and `config/public-chains.json`.
- Agent execution depends on contract ABIs, deployed addresses, `somnia-agent-kit`,
  and the env signer + encrypted session keys.
- Telegram quick actions depend on policy gates and nonce persistence.
- The on-chain guard depends on the validator module being installed on the
  ModularAccount and on a fresh ApprovalStore/agent approval.
- Inheritance safety depends on on-chain Reactivity scheduling + consensus-agent
  approval, with a manual fallback.

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Persistence:** collection names kebab-case (`risk-snapshots`,
`audit-events`); fields camelCase (`walletAddress`, `lastHeartbeatAt`); IDs use
explicit suffixes (`userId`, `actionNonce`).

**API:** REST endpoints use plural nouns / resource groups (`/api/users`,
`/api/portfolios`, `/api/heartbeats`, `/api/riskguard/*`); query params camelCase.

**Code:** TypeScript files kebab-case except React components (PascalCase
`.tsx`); services `*.service.ts`; repositories `*.repository.ts`; policies
`*-policy.ts`; jobs `*.job.ts`; Zod schemas `*Schema`.

### Structure Patterns

- `/agent/src/config`: env, logger, public-chain config.
- `/agent/src/persistence`: stores (`json-store`, `supabase-json-store`) +
  `*.repository.ts`.
- `/agent/src/services`: domain services.
- `/agent/src/integrations`: `somnia/`, `telegram/`.
- `/agent/src/policies`: deterministic gates.
- `/agent/src/jobs`: `setInterval` loops.
- `/agent/src/api`: `server.ts` + `response.ts`.
- Tests co-located as `*.test.ts`.

### Format Patterns

- **API success:** `{ "ok": true, "data": ..., "requestId": "..." }`
- **API failure:** `{ "ok": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }`
- Dates are ISO 8601 strings; on-chain bigints serialize as decimal strings.
- Wallet addresses checksum-normalized before persistence; risk scores `0-100`.
- Policy decisions carry `allowed`, `reason`, `policyId`, `signerAddress`,
  `chainId`, `target`, `calldataSummary`, `createdAt`, optional `expiresAt`.

### Communication & Telegram Patterns

- Audit records are append-only; every signed tx attempt records pre/post policy,
  tx hash if submitted, and final status.
- Telegram callback payloads are HMAC-SHA256-signed compact strings with action
  type, nonce, and TTL, bound to a wallet↔chat pairing; expired/replayed/forged
  callbacks fail closed.

### Process Patterns

- Validate at boundaries with Zod; never expose secrets, keys, tokens, or stack
  traces; pino structured logs internally.
- The on-chain Somnia risk agent review never directly authorizes a transaction;
  `somnia-agent-kit` calls go through policy gates; state-changing chain actions
  include policy result, signer, chain ID, target, and calldata summary.
- Demo scenarios are explicit and never silently target Somnia Testnet.
- ERC-4337 validation stays bounded — no synchronous external calls in
  `validateUserOp`.

### Enforcement Guidelines

**All AI Agents MUST:**
- Keep `/agent`, `/frontend`, `/contracts` boundaries clean.
- Use pnpm workspace scripts for JS/TS; Foundry for contract build/test/deploy.
- Add/update Zod schemas when changing external inputs or persisted shapes.
- Add tests for policy gates and contract safety behavior.
- Record intentional architectural deviations in `docs/CONTEXT.md` (append-only)
  with a matching `AD-N` row in `docs/ARCHITECTURE.md`.

**Anti-Patterns:**
- Hardcoded keys, RPC URLs, bot tokens, or private keys.
- The agent review (or any model output) directly authorizing transactions.
- Frontend handling backend private keys.
- Synchronous external calls inside `validateUserOp`.
- Silent fallback from testnet to demo mode.
- Store writes outside repository helpers.

## Project Structure & Boundaries

### Complete Project Directory Structure (as shipped)

```text
somnia-riskguard-agent/
├── _bmad-output/
│   └── planning-artifacts/        # this document, prd.md, etc.
├── config/
│   └── public-chains.json         # chain id/RPC/explorer/contract addresses (SoT)
├── docs/
│   ├── ARCHITECTURE.md            # canonical living architecture
│   ├── CONTEXT.md                 # append-only decision log (AD/D IDs)
│   └── ...                        # riskguard-validation-module.md, reactivity, etc.
├── infra/
│   └── supabase/                  # setup.sql
├── agent/
│   └── src/
│       ├── api/
│       │   ├── response.ts
│       │   └── server.ts          # native http router (+ server.test.ts)
│       ├── config/
│       │   ├── env.ts             # Zod, fail-closed (+ env.test.ts)
│       │   ├── logger.ts          # pino (+ logger.test.ts)
│       │   └── public-chain.ts    # reads config/public-chains.json
│       ├── integrations/
│       │   ├── somnia/
│       │   │   ├── somnia-agent-kit.client.ts  (+ .test.ts)
│       │   │   └── inheritance-registry.client.ts
│       │   └── telegram/
│       │       ├── telegram.client.ts          # BotApiClient / Disabled + polling
│       │       └── callback-signing.ts         # HMAC + nonce + TTL
│       ├── jobs/                  # setInterval loops
│       │   ├── portfolio-monitor.job.ts        (+ .test.ts)
│       │   ├── heartbeat.job.ts
│       │   ├── reward-claim.job.ts
│       │   └── riskguard-agent-review.job.ts
│       ├── persistence/
│       │   ├── json-store.ts                   (+ .test.ts)
│       │   ├── supabase-json-store.ts
│       │   ├── users.repository.ts
│       │   ├── session-keys.repository.ts
│       │   ├── audit-events.repository.ts
│       │   ├── portfolio-snapshots.repository.ts
│       │   ├── risk-snapshots.repository.ts
│       │   ├── reward-claims.repository.ts
│       │   ├── heartbeats.repository.ts
│       │   ├── telegram-bindings.repository.ts
│       │   ├── action-nonces.repository.ts
│       │   ├── alerts.repository.ts
│       │   └── data/              # JSON store (local/dev)
│       ├── policies/
│       │   ├── execution-policy.ts
│       │   ├── deadman-policy.ts
│       │   └── reward-claim-policy.ts
│       ├── services/
│       │   ├── portfolio.service.ts            (+ .test.ts)
│       │   ├── heartbeat.service.ts            (+ .test.ts)
│       │   ├── heartbeat-reminder-notifier.ts
│       │   ├── reward-claim.service.ts         (+ .test.ts)
│       │   ├── reward-claim-notifier.ts
│       │   ├── telegram-alert.service.ts       (+ .test.ts)
│       │   ├── telegram-connect.service.ts     (+ .test.ts)
│       │   ├── telegram-check-in.service.ts
│       │   ├── session-key.service.ts
│       │   ├── session-key-crypto.ts
│       │   ├── session-key-actions.ts
│       │   ├── riskguard-approval.service.ts
│       │   ├── setup.service.ts                (+ .test.ts)
│       │   ├── audit.service.ts
│       │   └── demo-scenario.service.ts
│       ├── utils/datetime.ts
│       ├── test-helpers/env.ts
│       ├── index.ts               # public surface for tests
│       └── main.ts                # bootstrap (+ main.test.ts)
├── contracts/
│   ├── src/
│   │   ├── InheritanceRegistry.sol            # RiskGuardInheritanceRegistry
│   │   ├── SomniaAgentInterfaces.sol          # IAgentRequester(+Handler)
│   │   └── riskguard/
│   │       ├── RiskGuardValidator.sol         # ERC-7579 module type 1
│   │       ├── RiskGuardHookModule.sol        # ERC-7579 module type 4 (experimental)
│   │       └── RiskGuardApprovalStore.sol     # 10-min TTL, consume-once
│   ├── test/
│   │   ├── InheritanceRegistry.t.sol
│   │   └── RiskGuardValidator.t.sol
│   ├── script/                    # deploy + configure:agents
│   ├── foundry.toml
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx           # ThirdwebAppProvider -> RiskGuardDashboard
│   │   ├── components/
│   │   │   ├── providers/thirdweb-app-provider.tsx
│   │   │   └── ui/                # badge, button, input, sonner, tooltip
│   │   ├── features/
│   │   │   ├── dashboard/
│   │   │   │   ├── riskguard-dashboard.tsx
│   │   │   │   ├── config.tsx · types.ts · utils.ts
│   │   │   │   ├── hooks/use-riskguard-dashboard.ts
│   │   │   │   └── components/    # overview, transfer-panel,
│   │   │   │                      # agent-review-modal, status-panels,
│   │   │   │                      # account-assets-panel, navigation, notice-toast
│   │   │   └── settings/          # inheritance + guardian settings
│   │   └── lib/
│   │       ├── thirdweb-client.ts · riskguard-module.ts
│   │       ├── inheritance-registry.ts · native-transfer.ts
│   │       ├── agent-api.ts · blockscout-api.ts
│   │       ├── wallet.ts · utils.ts
│   ├── components.json · next.config.ts · package.json · tsconfig.json
├── package.json · pnpm-workspace.yaml · tsconfig.json
└── README.md
```

### Architectural Boundaries

**API Boundaries:** Frontend talks only to the `/agent` REST API (Zod-validated,
`{ ok, data | error, requestId }`). Telegram callbacks enter through the Telegram
integration, then policy gates. Smart-contract calls flow through policy gates,
`somnia-agent-kit`, and ethers clients.

**Component Boundaries:** `/frontend` owns UI (wallet connect, transfers,
inheritance planning, profile/Telegram). `/agent` owns monitoring, on-chain
agent-review coordination, scheduling, Telegram, persistence, approval
coordination, and execution decisions. `/contracts` owns on-chain risk enforcement (validator/approval store)
and non-custodial inheritance. `/docs` owns canonical living documentation.

**Service Boundaries:** API handlers call services; services call repositories,
policies, and integrations; jobs call services; policies are pure modules
returning explicit allow/deny decisions.

**Data Boundaries:** Repositories are the only writers; the JSON store lives under
`agent/src/persistence/data` and Supabase tables are accessed only via the
service-role key server-side. The dashboard reads state via API, never directly.
Contract state is authoritative for guard enforcement and dead-man's-switch
activation. Secrets are env-only.

### Requirements to Structure Mapping

**Portfolio Monitoring + on-chain agent review:** `jobs/portfolio-monitor.job.ts`,
`services/portfolio.service.ts`, `jobs/riskguard-agent-review.job.ts`,
frontend overview section + `lib/blockscout-api.ts`.

**Active Risk Guard:** `contracts/src/riskguard/{RiskGuardValidator,
RiskGuardHookModule,RiskGuardApprovalStore}.sol`,
`contracts/src/SomniaAgentInterfaces.sol`, `services/riskguard-approval.service.ts`,
`jobs/riskguard-agent-review.job.ts`, session-key signing, frontend
`lib/riskguard-module.ts` + `agent-review-modal.tsx`,
`test/RiskGuardValidator.t.sol`.

**Non-custodial Inheritance:** `contracts/src/InheritanceRegistry.sol`,
`test/InheritanceRegistry.t.sol`, `integrations/somnia/inheritance-registry.client.ts`,
`services/heartbeat.service.ts`, `jobs/heartbeat.job.ts`, `policies/deadman-policy.ts`,
frontend `features/settings/*` + `lib/inheritance-registry.ts`.

**Telegram Alerts + Quick Actions:** `integrations/telegram/*`,
`persistence/action-nonces.repository.ts`, `services/telegram-*`,
`policies/execution-policy.ts`.

**Auto Claim Small Rewards:** `jobs/reward-claim.job.ts`,
`services/reward-claim.service.ts`, `policies/reward-claim-policy.ts`,
`integrations/somnia/somnia-agent-kit.client.ts`.

**Dashboard Setup + Transfers + Profile:** `frontend/features/dashboard/*`,
`lib/agent-api.ts`, `lib/wallet.ts`, `lib/native-transfer.ts`,
`lib/thirdweb-client.ts`.

**Demo Flow:** `services/demo-scenario.service.ts`, `/api/demo/scenarios`,
`contracts/script/*`.

### Integration Points

**Internal:** `agent/src/main.ts` loads + validates config (`loadConfig()`,
fail-closed), then `startAgentRuntime(config)` wires the logger, repositories
(Supabase + JSON store), the service graph, the
`SomniaAgentKitClient`, the HTTP API server, four `setInterval` jobs, and (if a
bot token is set) Telegram long-polling; it returns an `AgentRuntime` with
`stop()`. `agent/src/index.ts` re-exports the public surface for tests.

**External:** the Somnia risk agent (on-chain LLM Inference) via
`RiskGuardValidator.requestAgentReview` / `handleRiskAssessmentResponse`;
Telegram via `integrations/telegram/`; `somnia-agent-kit` + ethers + inheritance
registry via `integrations/somnia/`; Supabase via the persistence layer;
Blockscout + thirdweb from the frontend.

**Data Flow (revert-driven guard):**

```
User submits a risky UserOp on the smart account
  → RiskGuardValidator.validateUserOp() enforces policy
  → triggers (value ≥ threshold | batch | calldata | contract recipient)
  → reverts PendingApprovalRequired(account, txHash, signer, ctx)
  → agent/RPC reads the revert data:
       Telegram flow: TelegramAlertService sends approve/reject buttons
         → RiskGuardApprovalService.submitApproval() → RiskGuardApprovalStore (10-min TTL)
       Agent-first flow: requestAgentReview() → Somnia risk agent
         → handleRiskAssessmentResponse() records agentApprovals[acct][txHash]
  → user resubmits → validator finds a valid approval → execution allowed
     (consumeApproval() clears the store entry, one-time)
```

**Data Flow (inheritance / dead-man's-switch):**

```
Smart account createPlan(beneficiaries, assets, heartbeat, grace, timelock)
  → registry schedules distribution via Reactivity at timelockEndsAt
User checkIn() OR agent triggerAgentHeartbeat() → handleHeartbeatResponse()
  → refreshes the deadline (stale schedules skipped)
Heartbeat expires → Reactivity precompile (0x0100) → onEvent()
  → registry triggerDistributionAgent() → handleDistributionResponse()
  → _executeDistribution() transfers each asset to beneficiaries by share,
     FROM the user's smart account (agent mode skips failed transfers;
     manual executeInheritance() fails closed). Registry never custodies funds.
```

## API Architecture

Base path `/api`; uniform `{ ok, data | error, requestId }` envelope. Mutating
endpoints acting on a wallet require a signed-message proof. The canonical,
maintained endpoint table lives in `docs/ARCHITECTURE.md` (~35 endpoints). Groups:

- **setup/health:** `/setup/readiness`, `/health`, `/public-chain`
- **users/profile:** `/users` (POST), `/users/profile` (GET/PATCH)
- **portfolio/risk:** `/portfolios/latest`, `/risk-snapshots/latest`
- **audit:** `/audit-events/recent`
- **session keys:** `/session-keys/action`
- **inheritance:** `/inheritance/plan`
- **demo:** `/demo/scenarios`
- **heartbeats:** `/heartbeats/settings`, `/check-in`, `/status`,
  `/beneficiary-status`; `/deadman/policy-check`
- **rewards:** `/rewards/settings`, `/status`, `/fixtures`, `/run`,
  `/policy-check`
- **telegram:** `/telegram/health`, `/connect/{start,status,confirm}`,
  `/bindings` (GET/POST/DELETE), `/callback`
- **riskguard:** `/riskguard/pending-approval`, `/riskguard/agent-review/requested`

## Contracts Architecture

Foundry project (Solidity 0.8.35, `via_ir`, 200 runs, OpenZeppelin 5.6.1).
Deployed on Somnia Testnet; addresses in `config/public-chains.json`
(`inheritanceRegistry`, `riskGuardApprovalStore`, `riskGuardHookModule`,
`riskGuardValidatorModule`, `riskGuardModularAccountFactory`,
`riskGuardDefaultValidator`). AgentRequester (testnet 50312):
`0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`.

| Contract | Type | Responsibility |
|----------|------|----------------|
| `RiskGuardInheritanceRegistry` (`src/InheritanceRegistry.sol`) | App (`ReentrancyGuard`) | One non-custodial inheritance plan per smart account; beneficiaries (bps), protected assets, heartbeat/grace/timelock, check-in, beneficiary-change timelock, Reactivity-scheduled + agent-confirmed distribution, manual `executeInheritance` fallback. EOAs cannot create plans. |
| `RiskGuardValidator` (`src/riskguard/RiskGuardValidator.sol`) | ERC-7579 validator (type 1) | Enforces risk policy in `validateUserOp`; allows safe sub-threshold native transfers; blocks batches/calldata/contract recipients/over-threshold via `PendingApprovalRequired`; consumes ApprovalStore or Somnia agent approvals; `requestAgentReview` + `handleRiskAssessmentResponse`. The active guard. |
| `RiskGuardHookModule` (`src/riskguard/RiskGuardHookModule.sol`) | ERC-7579 hook (type 4) | Same policy via `preCheck`/`postCheck`; experimental — inactive on Thirdweb ModularAccount's primary execute path. |
| `RiskGuardApprovalStore` (`src/riskguard/RiskGuardApprovalStore.sol`) | Registry | Bridges agent/Telegram approvals on-chain: `registerAgentAndHook`, `submitApproval`, `consumeApproval`; 10-minute TTL, one-time use. |
| `SomniaAgentInterfaces.sol` | Interfaces | `IAgentRequester` / `IAgentRequesterHandler`, `Request`/`Response`/`ResponseStatus`/`ConsensusType`. |

ERC-7579 modules are installed on a Thirdweb ModularAccount (factory +
`DefaultValidator` for owner signatures) alongside the RiskGuard validator. Somnia
agents are invoked via `IAgentRequester.createRequest{value: deposit}` with a
`handleResponse(uint256,Response[],ResponseStatus,Request)` callback; callbacks
verify `msg.sender == platform`, track pending request IDs, decode only successful
responses, and enforce per-account agent budgets. Distribution scheduling uses the
Reactivity precompile `0x0100`; handler entrypoints are gated to that caller.
Tests: `test/InheritanceRegistry.t.sol` (plan lifecycle, heartbeat refresh,
Reactivity schedule + stale-skip, beneficiary timelock, agent
heartbeat/distribution, skip-on-fail, share integrity) and
`test/RiskGuardValidator.t.sol` (agent review request → approval → allowed
UserOp). Post-deploy wiring: `pnpm --dir contracts configure:agents`.

## Architecture Validation Results

### Coherence Validation

The shipped architecture is coherent. pnpm workspace orchestration, the Next.js
16 / thirdweb dashboard, the Node/TypeScript agent on ethers, Foundry ERC-7579
contracts, `somnia-agent-kit`, Telegram, and dual Supabase/JSON persistence fit
the constraints without forcing one runtime to own another. The active-guard
pivot (AD-4) resolves the core gap in the planning-era design: a passive score
cannot prevent loss, whereas `validateUserOp` enforcement does.

### Requirements Coverage Validation

- Portfolio monitoring + on-chain agent review: covered (jobs/services + agent-review job + dashboard).
- Active risk guard: covered (validator/approval store + agent review job +
  frontend module config).
- Non-custodial inheritance: covered (registry + Reactivity + consensus agents +
  manual fallback + frontend planner).
- Telegram quick actions: covered (signed callbacks + nonce persistence +
  policy gates).
- Auto reward claim: covered (job/service/policy + somnia-agent-kit).
- Demo flow: covered (demo-scenario service + `/api/demo/scenarios` + scripts).

Security, non-custody, auditability, and demo separation are covered
architecturally.

### Implementation Readiness Validation

Technology and responsibility decisions are documented and reflected in code; the
directory tree above matches the repository; naming, structure, response-format,
Telegram-callback, audit, policy, and execution-safety patterns are documented and
enforced.

### Gap Analysis / Open Questions

- Activate the ERC-7579 hook module once a ModularAccount variant runs hooks on
  the primary execute path (currently validator-only).
- Production database migration beyond Supabase REST + JSON store.
- Telegram webhook deployment (currently polling-only).
- External audit before mainnet / high-value usage.
- Multi-chain support beyond Somnia Testnet.

### Architecture Decisions Summary

Full rationale in `docs/CONTEXT.md`; AD-N rows summarized in `docs/ARCHITECTURE.md`.

| ID | Topic | Summary |
|----|-------|---------|
| AD-1 | pnpm workspace + focused starters | One repo; Next.js/agent/Foundry surfaces |
| AD-2 | Risk intelligence is on-chain agent review (no off-chain LLM) | Somnia risk agent decides APPROVE/REJECT; off-chain LLM providers removed; execution still gated by validator + signature |
| AD-3 | Deterministic policy gates | Explicit allow/deny before every signature |
| AD-4 | Active ERC-7579 smart-account guard | `validateUserOp` enforcement + revert-driven approval |
| AD-5 | Non-custodial inheritance | Funds stay in the smart account; registry stores policy only |
| AD-6 | Reactivity + consensus Agents | On-chain scheduling/approval, not off-chain polling |
| AD-7 | thirdweb (AA) + ethers (agent) | Frontend AA via thirdweb; backend ethers v6 |
| AD-8 | Supabase + JSON-store persistence | Encrypted session keys/users in Supabase; JSON store local |
| AD-9 | Telegram polling + signed callbacks | HMAC + nonce + TTL replay protection |
| AD-10 | Public chain config is SoT | `config/public-chains.json` for chain/contract metadata |

### Architecture Readiness Assessment

**Overall Status:** SHIPPED (v0.1.0) — implemented and aligned with this document.

**Confidence Level:** high

**Key Strengths:**
- Active on-chain enforcement (guard) rather than passive scoring.
- On-chain agent-review isolation + deterministic policy gates + bounded ERC-4337 validation.
- Non-custodial inheritance with on-chain scheduling and consensus agents.
- Clean `/agent` · `/frontend` · `/contracts` separation; canonical living docs.

**Areas for Future Enhancement:** hook activation, production DB, Telegram
webhooks, external audit, multi-chain.

### Implementation Handoff

- Treat `docs/ARCHITECTURE.md` and `docs/CONTEXT.md` as the source of truth; this
  planning artifact is a point-in-time snapshot revised to match them.
- Follow the documented patterns and respect surface boundaries.
- Never bypass policy gates or place synchronous external calls inside
  `validateUserOp`.
- Record intentional architectural changes in `docs/CONTEXT.md` (append-only) with
  a matching `AD-N` row in `docs/ARCHITECTURE.md`.
