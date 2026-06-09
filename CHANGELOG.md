# Changelog

All notable changes to SomGuard will be documented in this file.

This project follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/). Entries are reverse-chronological.

## [Unreleased]

### Added
- **Approval Risk Scanner — "Allowances" tab (revoke.cash-style).** Lists every
  contract a wallet approved as a token spender and scores each 0–100 using **all
  three Somnia base agents**.
  - Contract `contracts/src/riskguard/ApprovalRiskScanner.sol`: `requestScan`
    escrows 3 agent deposits and fans out the **JSON API Request** + **LLM Parse
    Website** agents on the representative item, then on fan-in fires the **LLM
    Inference** agent for a batch summary; each item is stored with a 0–100
    `riskScore` + LOW/MEDIUM/HIGH `verdict` (`ItemScored`). `getScan`/`getItem`/
    `quoteScan` views, `claimRefund`, and `configureAgents`. Tests in
    `contracts/test/ApprovalRiskScanner.t.sol`; wired by `configure:agents`.
  - Backend `agent/src/services/approval-scanner.service.ts` + routes
    `/api/approvals/{chains,list,scan/prepare,scan/status}`. Approval **discovery**
    uses each chain's Blockscout `getLogs` indexer (raw RPC `eth_getLogs` is capped
    at 1000 blocks on Somnia), then live `allowance`/`isApprovedForAll` reads.
  - Frontend `frontend/src/features/dashboard/components/approvals-panel.tsx` +
    `hooks/use-approval-scanner.ts`: multi-chain select (Somnia first), one signed
    `requestScan` tx, polled per-approval scores. Read-only (no revoke).
  - Config: `config/public-chains.json` gains `scanChains[]` (Somnia mainnet +
    testnet, Blockscout `explorerApiBaseUrl`) and `contracts.approvalRiskScanner`;
    new `APPROVAL_SCANNER_*` env vars.

### Changed
- **Inheritance plan creation is now a single wallet signature.** The dashboard
  bundles `installModule(2, registry)` + `fundAgentBudget` + `createPlan` into one
  ERC-7579 batch UserOp (`sendRiskGuardedSmartBatch`, calltype `0x01`) in
  `frontend/src/lib/inheritance-registry.ts`.
- **Registry authorization switched from `grantRoles` to `installModule`.** Solady
  `grantRoles` is `onlyOwner` and reverts `Unauthorized()` (`0x82b42900`) on a
  self-call inside a batch; ERC-7579 `installModule` is `onlyEntryPointOrSelf` and
  installs the registry as the account's executor module (type 2) used by
  `executeFromExecutor` at distribution time.
- **Telegram-first gate.** Enabling RiskGuard and creating an inheritance plan now
  show a warning toast and abort unless Telegram is connected, so alerts/heartbeat
  reminders always have a delivery channel (`use-riskguard-dashboard.ts`).
- **`RiskGuardInheritanceRegistry` redeployed** on Somnia testnet to
  `0x355D81e993Bc423C81b8fe348fEEe659E738710E` (`MIN_HEARTBEAT_DURATION = 1 days`);
  `config/public-chains.json` + `.env` updated.

### Fixed
- Frontend env: documented `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` (derived from
  `THIRDWEB_SECRET_KEY`) in `frontend/.env.local`, fixing "Smart account creation is
  not configured yet"; Telegram "Connect" now opens the bot synchronously inside the
  click gesture (popup-blocker fix); `<html>`/`<body>` get `suppressHydrationWarning`
  for extension-injected attributes.

---

## [0.1.0] — 2026-06-04 — Agentathon MVP: active RiskGuard guard + inheritance — v0.1.0

First consolidated MVP of the SomGuard across all seven planned
epics. The product pivoted from passive LLM portfolio scoring to an **active
ERC-7579 smart-account guard** with revert-driven, agent/Telegram-confirmed
approvals, plus a non-custodial heartbeat-driven inheritance registry enforced by
Somnia Reactivity and consensus Somnia Agents.

### Added
- **Agent runtime** (`/agent`): Zod-validated fail-closed config + secret-safe
  pino logging; native-`http` API server with uniform `{ ok, data, requestId }`
  responses; four polled jobs (portfolio-monitor 30s, heartbeat-reminders 60s,
  reward-claims 60s, riskguard-agent-review 15s).
- **AI risk review**: risky transactions reviewed by a consensus-validated Somnia
  risk agent (on-chain LLM Inference via `RiskGuardValidator.requestAgentReview`),
  returning an APPROVE/REJECT decision. No off-chain LLM provider — Groq/DeepSeek
  were removed (see Changed). Risk snapshots persisted with threshold results.
- **RiskGuard active guard** (`/contracts/src/riskguard`): ERC-7579
  `RiskGuardValidator` (type 1) enforcing policy in `validateUserOp`,
  experimental `RiskGuardHookModule` (type 4), and `RiskGuardApprovalStore`
  (10-min TTL, one-time approvals) bridging Telegram/agent decisions on-chain.
- **Smart-account inheritance** (`RiskGuardInheritanceRegistry`): non-custodial
  plan per smart account, heartbeat/grace/timelock, beneficiary-change timelock,
  Somnia Reactivity scheduling, agent heartbeat/distribution callbacks, manual
  `executeInheritance` fallback.
- **Somnia agent integration**: `IAgentRequester`/handler interfaces,
  `requestAgentReview` + `handleRiskAssessmentResponse`, per-account agent
  budgets, `configure:agents` deploy wiring.
- **Telegram**: bot polling, HMAC-signed nonce/TTL callback payloads, connect
  state machine, risk alerts with approve/refresh buttons, check-in command.
- **Reward automation**: detection, value/gas policy gate (auto-claim,
  min-reward, max-gas), execution via agent wallet, outcome notifications.
- **Persistence**: dual `RepositoryStore` — Supabase REST (`agent_records`,
  `users`, encrypted `session_keys`) and JSON-file store for local/dev.
- **Frontend** (`/frontend`): Next.js 16 / React 19 dashboard — overview
  (Blockscout assets + RiskGuard policy), native transfer, inheritance plan
  builder, profile + Telegram connect; thirdweb v5 ERC-7579 modular smart account
  with gas sponsorship; agent REST client.
- **Docs**: `docs/ARCHITECTURE.md`, `docs/CONTEXT.md` (AD-1…AD-10), `docs/SETUP.md`.

### Changed
- Risk model pivoted from passive scoring to active `validateUserOp` enforcement
  with on-chain approval gating (supersedes the score-centric planning PRD).
- Renamed the project to **SomGuard** (was "Somnia RiskGuard Agent"); "RiskGuard"
  remains the name of the on-chain guard module.

### Removed
- Off-chain LLM risk scoring (Groq + DeepSeek): deleted `GroqClient`,
  `DeepSeekClient`, `RiskScoreService`, the `RiskProvider` abstraction, the
  `GROQ_*`/`DEEPSEEK_*` env vars, the `POST /api/risk-snapshots/analyze` and
  `POST /api/telegram/test-alert` endpoints, and the Telegram risk-score alert.
  Risk intelligence is now solely the on-chain Somnia agent review (see [D11]).
- Persistence revised from JSON-files-only (planning era) to Supabase + JSON-store
  dual implementation with encrypted session keys.
- Frontend AA standard moved to ERC-7579 modular accounts via thirdweb;
  inheritance modeled as a non-custodial living vault (standalone deposit vault
  removed as a user-facing path).
- Inheritance scheduling moved from off-chain polling to Somnia Native On-Chain
  Reactivity + consensus agents.

**Commit**: a0dcb85
