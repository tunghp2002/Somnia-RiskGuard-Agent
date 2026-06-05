# ARCHITECTURE — SomGuard

> Last updated: 2026-06-04 (v0.1.0)
> Maintainer: tug / @tunghp2002

## System overview

SomGuard is an on-chain AI portfolio guardian for the Somnia
Agentic L1. It combines three runtime surfaces in a single pnpm monorepo: a
**Node.js/TypeScript agent runtime** (`/agent`) that monitors portfolios,
coordinates RiskGuard approvals via Telegram, and executes bounded
on-chain actions; a **Next.js dashboard** (`/frontend`) for wallet setup,
RiskGuard policy configuration, native transfers, and inheritance planning on a
Thirdweb ERC-7579 modular smart account; and **Solidity contracts**
(`/contracts`, Foundry) implementing an ERC-7579 RiskGuard validator/hook +
approval store and a heartbeat-driven inheritance registry.

The product pivoted from passive off-chain LLM portfolio *scoring* to an **active
smart-account guard**: risky transactions are blocked at `validateUserOp` time
by an on-chain validator module and only proceed after a review approval — from a
consensus-validated **Somnia risk agent** (on-chain LLM Inference) or a
Telegram-confirmed user — recorded as a short-lived on-chain approval. The agent
runtime no longer runs any off-chain LLM (Groq/DeepSeek were removed); risk
intelligence lives in the on-chain Somnia agent review. Inheritance
("dead man's switch") is enforced on-chain via Somnia Native On-Chain Reactivity
plus consensus-validated Somnia Agents, never by trusted off-chain polling.

Architectural drivers: **security** (the risk review is advisory/decisional but
execution authority is on-chain — a transaction proceeds only via the validator's
approval check plus a user/agent signature; agent wallet authority is bounded by
deterministic policy gates), **non-custody** (user funds stay in the user's smart account;
contracts hold only policy/state), **auditability** (every state-changing
attempt records signer, chain ID, target, calldata summary, and outcome), and
**demo readiness** for Agentathon judging.

## Tech stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Monorepo | pnpm workspace | pnpm 10.23.0 | One package manager; `/agent`, `/frontend`, `/contracts` as workspaces |
| Agent runtime | Node.js + TypeScript | TS 6.x, NodeNext ESM | Long-running monitor + HTTP API; `tsx` for dev, `tsc` for build |
| Agent HTTP | Node `http` (native) | — | No framework; `createAgentApiServer` with a manual router + Zod validation |
| EVM (agent) | ethers | 6.16 | Contract reads/writes, address checksum, signing for agent actions |
| Validation | zod | 4.x | Env config, request payloads, LLM output, policy decisions, JSON shapes |
| Logging | pino | 10.x | Structured, secret-redacting logs to stdout |
| Risk intelligence | Somnia risk agent (on-chain LLM Inference) | — | Risky txs reviewed by a consensus Somnia agent returning APPROVE/REJECT; no off-chain LLM provider |
| Somnia SDK | somnia-agent-kit | 3.0.11 | Agent-kit boundary for portfolio/reward/approval tool calls |
| Persistence | Supabase (Postgres REST) + JSON-file fallback | — | `users` + `session_keys` in Supabase; collection records in `agent_records`; JSON store for local/dev |
| Frontend | Next.js (App Router) + React | Next 16.2, React 19.2 | Client-rich dashboard; no SSR data path |
| Wallet / AA | thirdweb | 5.120 | ERC-4337/ERC-7579 modular smart account, gas sponsorship, connect UX |
| Styling | Tailwind CSS + shadcn/ui (New York) | Tailwind 4.x | App shell, panels, forms; dark theme via CSS vars |
| Toasts/icons | sonner, lucide-react | 2.x / 1.x | Notices and iconography |
| Explorer data | Blockscout (Shannon explorer) | — | Token/NFT enumeration for EOA + smart account |
| Contracts | Solidity + Foundry (forge) | 0.8.35, via_ir, 200 runs | Fast Solidity-first iteration + Anvil simulation |
| Contract libs | OpenZeppelin Contracts | 5.6.1 | `ReentrancyGuard`, `SafeERC20`, ERC interfaces |
| Chain | Somnia Testnet | chainId 50312 | STT native token; `config/public-chains.json` is the metadata source of truth |

## Component architecture

```
                ┌─────────────────────────────────────────┐
   Browser  ───▶│  Next.js Dashboard (/frontend)          │
   wallet       │  thirdweb AA · ethers v6 · Blockscout    │
                └───────────────┬─────────────────────────┘
                                │ REST (NEXT_PUBLIC_AGENT_API_URL)
                                ▼
                ┌─────────────────────────────────────────┐
   Telegram ◀──▶│  Agent HTTP API (/agent, native http)    │
   Bot          │  Zod-validated routes · { ok, data, ... } │
                └───┬──────────────┬──────────────┬─────────┘
                    │              │              │
        ┌───────────▼──┐   ┌───────▼──────┐  ┌────▼──────────────┐
        │ Services     │   │ Jobs (setInterval) │ Policies (pure) │
        │ portfolio,   │   │ portfolio-monitor 30s │ execution      │
        │ audit,       │   │ heartbeat-remind  60s │ deadman        │
        │ heartbeat,   │   │ reward-claims     60s │ reward-claim   │
        │ reward-claim,│   │ riskguard-review  15s │                │
        │ telegram-*,  │   └───────┬──────────────┘└────────────────┘
        │ session-key, │           │
        │ riskguard-   │   ┌───────▼──────────────────────────────┐
        │ approval     │   │ Integrations                          │
        └──────┬───────┘   │ telegram (bot) · somnia (agent-kit,   │
               │           │ inheritance registry)                 │
               ▼           └───────┬──────────────────────────────┘
     ┌──────────────────┐          │ ethers v6
     │ Persistence       │         ▼
     │ Supabase REST +   │   ┌───────────────────────────────────┐
     │ JSON store        │   │ Somnia Testnet (RPC 50312)         │
     │ (repositories)    │   │  InheritanceRegistry               │
     └──────────────────┘    │  RiskGuardValidator (ERC-7579 t1)  │
                             │  RiskGuardHookModule (ERC-7579 t4) │
                             │  RiskGuardApprovalStore            │
                             │  ApprovalRiskScanner (3-agent scan)│
                             │  Thirdweb ModularAccount + Factory │
                             │  Somnia AgentRequester (agents)    │
                             │  Reactivity precompile (0x0100)    │
                             └───────────────────────────────────┘
```

| Component | Responsibility | Tech | Key files |
|-----------|---------------|------|-----------|
| Dashboard | Wallet connect, RiskGuard policy, transfers, inheritance, profile/Telegram | Next.js 16, thirdweb | `frontend/src/features/dashboard/`, `frontend/src/features/settings/` |
| Agent API | Read state, configure, callbacks (Telegram/RiskGuard) | Node `http` + Zod | `agent/src/api/server.ts`, `agent/src/api/response.ts` |
| Jobs | Polled monitor/heartbeat/reward/review loops | `setInterval` | `agent/src/jobs/*.job.ts` |
| Services | Domain logic (portfolio, heartbeat, reward, telegram, session-key, approvals) | TS | `agent/src/services/*.service.ts` |
| Approval scanner | revoke.cash-style approval discovery (Blockscout indexer) + 3-agent risk scan orchestration | TS + ethers + fetch | `agent/src/services/approval-scanner.service.ts` |
| Policies | Deterministic allow/deny gates before signing | Pure TS + Zod | `agent/src/policies/*.ts` |
| Integrations | Telegram, Somnia agent-kit, inheritance registry | ethers, fetch | `agent/src/integrations/**` |
| Persistence | Repositories over Supabase REST / JSON store | Supabase + fs | `agent/src/persistence/*` |
| Contracts | ERC-7579 risk guard + inheritance dead man's switch | Solidity, Foundry | `contracts/src/**` |
| Chain config | Non-secret chain + contract metadata | JSON | `config/public-chains.json` |

## Agent runtime architecture

**Bootstrap** (`agent/src/main.ts`): `main()` loads + validates config via
`loadConfig()` (Zod, fail-closed) then `startAgentRuntime(config)` wires the
logger (`createLogger`), the Supabase-backed repositories (`SupabaseUsersRepository`,
`SupabaseSessionKeysRepository`) plus JSON-store-backed repositories for the rest,
the service graph, the `SomniaAgentKitClient`, the HTTP API server, four
background jobs, and (if a bot
token is configured) Telegram long-polling. Returns an `AgentRuntime` with a
`stop()` handle. `agent/src/index.ts` re-exports the public surface for tests.

**HTTP API** (`agent/src/api/server.ts`): native `http.createServer` with a
manual router. Responses are uniform — success `{ ok: true, data, requestId }`,
failure `{ ok: false, error: { code, message, ... }, requestId }`. Boundary
errors map to status codes (ZodError/AddressValidationError → 400, payload too
large → 413, dependency errors → 500). Endpoint groups: setup/readiness, users
& profile, portfolios, risk-snapshots (latest), audit-events, health,
public-chain, session-keys, inheritance plan, demo scenarios, heartbeats
(settings / check-in / status / beneficiary-status), deadman policy-check,
rewards (settings / status / fixtures / run / policy-check), telegram (health /
connect start·status·confirm / bindings / callback), and riskguard
(pending-approval / agent-review requested). See the **API architecture** table
below for the canonical list.

**Jobs** (`agent/src/jobs/`), all `setInterval`-driven:
- `portfolio-monitor.job.ts` — every 30s: `PortfolioService.collectForConfiguredWallets()` detects portfolio changes and persists snapshots + audit events (no off-chain LLM scoring).
- `heartbeat.job.ts` — every 60s: `HeartbeatService.evaluateReminders()`; sends Telegram reminders before heartbeat expiry.
- `reward-claim.job.ts` — every 60s: `RewardClaimService.run()`; auto-claims eligible rewards under policy.
- `riskguard-agent-review.job.ts` — every 15s: polls `RiskGuardValidator` `RiskAgentReviewCompleted` events and notifies the bound Telegram chat of the on-chain agent decision; tracks `lastScannedBlock`.

**Services** (`agent/src/services/`): `portfolio`, `heartbeat`, `reward-claim`,
`telegram-alert` (binding, callbacks, signed buttons, RiskGuard approval/agent-
review alerts), `telegram-connect` (link state machine), `telegram-check-in`,
`session-key` (+ `session-key-crypto`, `session-key-actions`), `setup`,
`riskguard-approval` (submits approvals to the approval store via session-key
signer), `audit`, `demo-scenario`, plus reminder/claim notifier adapters. There
is no off-chain risk-scoring service — risk decisions come from the on-chain
Somnia risk agent review.

**Integrations** (`agent/src/integrations/`):
`somnia/somnia-agent-kit.client.ts` wraps the agent-kit SDK (portfolio, reward,
approval tools) behind policy checks; `somnia/inheritance-registry.client.ts`
reads dead-man-switch state. `telegram/telegram.client.ts` provides
`BotApiClient`/`DisabledTelegramClient` + long-polling; `telegram/callback-signing.ts`
HMAC-SHA256-signs compact button payloads with nonce + TTL.

**Policies** (`agent/src/policies/`) return a `PolicyDecision` (`allowed`,
`reason`, `policyId`, `signerAddress`, `chainId`, `target`, `calldataSummary`,
`createdAt`, optional `expiresAt`): `execution-policy` whitelists
`claim_small_reward` and `deadman_check_in`; `deadman-policy` requires
beneficiary == requester, contract ready, heartbeat expired, timelock complete,
not already executed; `reward-claim-policy` requires the claim action, auto-claim
enabled, reward ≥ min, gas ≤ max, and the decision expires after 60s.

## Data architecture

State persists through typed repositories over two interchangeable stores
implementing the same `RepositoryStore<T>` contract:
- **`SupabaseJsonStore`** — REST over Supabase; collection records in
  `agent_records` (collection + JSONB), upsert-on-write. `users` and
  `session_keys` use dedicated Supabase tables via their repositories.
- **`JsonStore`** — file-backed (`agent/src/persistence/data/*.json`) with a
  write queue; used for local/dev and tests.

| Repository | Stores |
|-----------|--------|
| `users` (Supabase) | wallet address + display name |
| `session-keys` (Supabase) | encrypted session keys for smart-account actions |
| `audit-events` | append-only `{ eventType, status, metadata, createdAt }` |
| `portfolio-snapshots` | assets, USD value, rewards, risk signals per wallet |
| `risk-snapshots` | risk snapshots (demo scenarios / on-chain agent review) + thresholds |
| `reward-claims` | reward settings, fixtures, claim history |
| `heartbeats` | heartbeat config/state per wallet & beneficiary |
| `telegram-bindings` | wallet → chatId binding + metadata |
| `action-nonces` | nonce tracking for replay prevention |
| `alerts` | risk alert records |

Secrets (agent signer key, encryption key, API tokens) live **only** in env, never
in persisted state. Non-secret chain/contract metadata lives in
`config/public-chains.json`.

### Risk-guard approval data flow (revert-driven)

```
User submits a risky UserOp on the smart account
  │  validateUserOp() in RiskGuardValidator enforces policy
  ▼
Policy triggers (value ≥ threshold | batch | calldata | contract recipient)
  │  module reverts PendingApprovalRequired(smartAccount, txHash, signer, ctx)
  ▼
Agent/RPC reads the revert data (NOT an event)
  ├── Telegram flow: TelegramAlertService sends approve/reject buttons
  │     → user approves → RiskGuardApprovalService.submitApproval()
  │       writes RiskGuardApprovalStore (10-min TTL)
  └── Agent-first flow: requestAgentReview() → Somnia risk agent →
        handleRiskAssessmentResponse() stores agentApprovals[acct][txHash]
  ▼
User resubmits → validator finds a valid approval → execution allowed
  (hook module consumeApproval() one-time clears the store entry)
```

### Inheritance / dead-man's-switch data flow

```
Smart account createPlan(beneficiaries, assets, heartbeat, grace, timelock)
  │  registry schedules distribution via Somnia Reactivity at timelockEndsAt
  ▼
User checkIn()  OR  agent triggerAgentHeartbeat() → handleHeartbeatResponse()
  │  refreshes the deadline (stale schedules are skipped)
  ▼
Heartbeat expires → Reactivity precompile (0x0100) calls onEvent()
  │  → registry requests the Somnia distribution agent
  ▼
handleDistributionResponse() → _executeDistribution() transfers each asset to
  beneficiaries by share (agent mode skips failed transfers; manual
  executeInheritance() fails closed). Funds move FROM the user's smart account;
  the registry never custodies funds.
```

### Approval risk scan data flow (revoke.cash-style, 3-agent fan-out)

Discovery is **off-chain per selected chain**; risk scoring runs **on Somnia**
via the three base agents. The single signed tx is always on Somnia (it pays the
agent deposits).

```
Discovery (off-chain, ApprovalScannerService):
  GET /api/approvals/list?walletAddress&chainIds
    │  Blockscout indexer  /api?module=logs&action=getLogs   (full range, NOT raw
    │  RPC — Somnia eth_getLogs caps at 1000 blocks), topic0 = Approval /
    │  ApprovalForAll, topic1 = owner. ERC-20 (3 topics) vs ERC-721 (4 topics) split.
    ▼
  Per (token, spender): read live allowance() / isApprovedForAll() over RPC,
  drop zeroed/revoked, read symbol()/name(), flag isUnlimited (≥ 2^255).

Scoring (on-chain, ApprovalRiskScanner.sol on Somnia):
  POST /api/approvals/scan/prepare → ABI-encoded requestScan(items[]) + msg.value
    │  user signs ONE tx
    ▼
  requestScan escrows deposits; per item fires in parallel:
    JSON API Request agent (fetchString  → explorer getsourcecode facts)
    LLM Parse Website agent (ExtractString → explorer address-page red flags)
    │  both callbacks return → fan-in
    ▼
  LLM Inference agent (inferString) combines facts+findings+context → "NN|verdict"
    │  → ItemScored event; ScanCompleted when all items done
    ▼
  GET /api/approvals/scan/status?scanId  reads getScan()/getItem() views → score/verdict
```

Failed/timed-out stage-1/2 responses still progress (empty data) so the pipeline
never stalls; inference failure is fail-safe scored `100` (treat as high risk).

## API architecture

Base path `/api`. All responses use the `{ ok, data | error, requestId }` shape.
Mutating endpoints that act on a wallet require a signed-message proof.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/setup/readiness` | GET | Wallet/session-key/config readiness |
| `/api/users` | POST | Register a monitored wallet (signed) |
| `/api/users/profile` | GET / PATCH | Read / update display name |
| `/api/portfolios/latest` | GET | Latest portfolio snapshot |
| `/api/risk-snapshots/latest` | GET | Latest risk snapshot (demo / agent review) |
| `/api/audit-events/recent` | GET | Recent audit events (limit) |
| `/api/health` | GET | Telegram / Somnia / public-chain health |
| `/api/public-chain` | GET | Chain + contract metadata |
| `/api/approvals/chains` | GET | Supported scan chains (Somnia first) |
| `/api/approvals/list` | GET | Discover active token approvals for a wallet (Blockscout indexer) |
| `/api/approvals/scan/prepare` | POST | Build the `requestScan` calldata + deposit for the user to sign |
| `/api/approvals/scan/status` | GET | Per-item agent risk scores for a scanId |
| `/api/session-keys/action` | POST | Vend a session key for an action |
| `/api/inheritance/plan` | GET | Inheritance plan state for a smart account |
| `/api/demo/scenarios` | POST | Run a deterministic demo scenario |
| `/api/heartbeats/settings` | POST | Configure heartbeat parameters |
| `/api/heartbeats/check-in` | POST | Renew heartbeat (signed) |
| `/api/heartbeats/status` | GET | Heartbeat status for a wallet |
| `/api/heartbeats/beneficiary-status` | GET | Beneficiary-safe status |
| `/api/deadman/policy-check` | POST | Evaluate deadman execution policy |
| `/api/rewards/settings` | POST | Set auto-claim parameters |
| `/api/rewards/status` | GET | Reward claim status |
| `/api/rewards/fixtures` | POST | Seed a demo reward fixture |
| `/api/rewards/run` | POST | Execute the reward-claim job |
| `/api/rewards/policy-check` | POST | Evaluate reward-claim policy |
| `/api/telegram/health` | GET | Telegram bot health |
| `/api/telegram/connect/start` | POST | Begin Telegram link, return code |
| `/api/telegram/connect/status` | GET | Link flow status |
| `/api/telegram/connect/confirm` | POST | Complete link with code + chatId |
| `/api/telegram/bindings` | GET / POST / DELETE | Read / link / unlink (signed) |
| `/api/telegram/callback` | POST | Process signed Telegram button callback |
| `/api/riskguard/pending-approval` | POST | Send a RiskGuard approval request to Telegram |
| `/api/riskguard/agent-review/requested` | POST | Notify user a Somnia agent review was requested |

### Error response format

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "..." }, "requestId": "..." }
```

## Contracts architecture

Foundry project (Solidity 0.8.35, `via_ir`, OpenZeppelin 5.6.1). Deployed on
Somnia Testnet (addresses in `config/public-chains.json`).

| Contract | Type | Responsibility |
|----------|------|----------------|
| `RiskGuardInheritanceRegistry` (`src/InheritanceRegistry.sol`) | App contract (`ReentrancyGuard`) | One inheritance plan per smart account: beneficiaries (addr + bps), protected assets, heartbeat/grace/timelock, check-in, beneficiary-change timelock, Reactivity-scheduled + agent-confirmed distribution, manual `executeInheritance` fallback. Non-custodial. |
| `RiskGuardValidator` (`src/riskguard/RiskGuardValidator.sol`) | ERC-7579 validator (module type 1) | Enforces risk policy in `validateUserOp` (ERC-4337). Allows safe sub-threshold native transfers; blocks batches, calldata, contract recipients, and over-threshold value via `PendingApprovalRequired` revert; consumes ApprovalStore approvals or Somnia agent approvals; `requestAgentReview` + `handleRiskAssessmentResponse`. |
| `RiskGuardHookModule` (`src/riskguard/RiskGuardHookModule.sol`) | ERC-7579 hook (module type 4) | Same policy via `preCheck`/`postCheck`; experimental — Thirdweb's ModularAccount does not run hooks on its primary execute path, so the validator is the active guard. |
| `RiskGuardApprovalStore` (`src/riskguard/RiskGuardApprovalStore.sol`) | Registry | Bridges agent/Telegram approvals on-chain: `registerAgentAndHook`, `submitApproval`, `consumeApproval`, 10-minute TTL, one-time use. |
| `ApprovalRiskScanner` (`src/riskguard/ApprovalRiskScanner.sol`) | App contract (`ReentrancyGuard`) | revoke.cash-style approval risk scoring. `requestScan(items[])` escrows deposits and per item fans out to the **JSON API Request + LLM Parse Website** agents, then on fan-in fires the **LLM Inference** agent for a `0–100\|verdict`. Three callbacks dispatched by `requestId→stage`; escrow draw-down + `claimRefund`; `quoteScan`/`getScan`/`getItem` views. Configured via `configureAgents(platform, jsonApiId, parseWebsiteId, llmInferenceId)`. |
| `SomniaAgentInterfaces.sol` | Interfaces | `IAgentRequester` / `IAgentRequesterHandler`, `Request`/`Response`/`ResponseStatus`/`ConsensusType` for Somnia agent invocation + callbacks. |

ERC-7579 modules are installed on a **Thirdweb ModularAccount** (factory +
`DefaultValidator` for owner signatures) alongside the RiskGuard validator. Somnia
agents are invoked via `IAgentRequester.createRequest{value: deposit}` with a
`handleResponse(uint256,Response[],ResponseStatus,Request)` callback; callbacks
verify `msg.sender == platform`, track pending request IDs, and decode only
successful responses. Distribution scheduling uses the Reactivity precompile
(`0x0100`); handler entrypoints are gated to that caller. Tests:
`test/InheritanceRegistry.t.sol` (plan lifecycle, heartbeat refresh, Reactivity
schedule + stale-skip, beneficiary timelock, agent heartbeat/distribution,
skip-on-fail, share integrity), `test/RiskGuardValidator.t.sol` (agent review
request → approval → allowed UserOp), and `test/ApprovalRiskScanner.t.sol`
(fan-in → inference → `ItemScored`, deposit math, duplicate/failed callbacks,
unknown-requestId revert). Post-deploy agent wiring:
`pnpm --dir contracts configure:agents` (wires RiskGuard, Inheritance, **and the
ApprovalRiskScanner** agent IDs).

## Frontend architecture

Next.js App Router app under `frontend/src/app/` (root `frontend/app/` is a thin
compat shim). `page.tsx` renders `ThirdwebAppProvider` → `RiskGuardDashboard`.
Client-rich, no SSR data path. Five dashboard sections via
`use-riskguard-dashboard.ts`: **overview** (Blockscout assets + RiskGuard policy
status), **transfer** (native STT send from EOA or smart account with gas
estimate and agent-review handling), **allowances** (Approval Risk Scanner —
`components/approvals-panel.tsx` + `hooks/use-approval-scanner.ts`: chain
multi-select, approval list, sign `requestScan`, poll per-spender agent scores),
**profile** (display name + Telegram connect), **inheritance** (plan builder).
RiskGuard module install + policy
config lives in `lib/riskguard-module.ts`; smart-account/chain/AA setup in
`lib/thirdweb-client.ts` (`createThirdwebAccountAbstraction`, deterministic
`riskGuardAccountSalt`); inheritance contract calls in `lib/inheritance-registry.ts`;
backend REST client in `lib/agent-api.ts`; asset enumeration in
`lib/blockscout-api.ts`; browser wallet in `lib/wallet.ts`. UI primitives are
shadcn (button, input, badge, tooltip, sonner). Env consumed:
`NEXT_PUBLIC_THIRDWEB_CLIENT_ID`, `NEXT_PUBLIC_AGENT_API_URL`/`_BASE_URL`,
`NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, `NEXT_PUBLIC_APP_NAME`.

## Security architecture

| Concern | Approach | Detail |
|---------|----------|--------|
| Risk decision isolation | On-chain agent review | The Somnia risk agent's APPROVE/REJECT never directly authorizes a tx; only the validator's approval check + a user/agent signature execute it |
| On-chain risk gate | ERC-7579 validator | `validateUserOp` blocks risky txs with `PendingApprovalRequired`; no synchronous external/LLM calls in validation |
| Approval freshness | TTL + one-time use | ApprovalStore 10-min TTL; agent approvals expire; consumed once |
| Wallet separation | Browser vs agent | Frontend never holds private keys; agent signer + session keys are env/Supabase-encrypted |
| Session keys | AES encryption at rest | `session-key-crypto` + `SESSION_KEY_ENCRYPTION_KEY` (32-byte); stored encrypted in Supabase |
| Telegram actions | Signed callbacks | HMAC-SHA256, nonce, TTL, wallet↔chat binding; replays fail closed |
| Policy gates | Deterministic, pre-sign | Every state-changing action carries signer, chainId, target, calldata summary |
| Dead-man-switch | On-chain timelock | Activation requires on-chain expiry + timelock, not off-chain judgement; non-custodial |
| Input validation | Zod at boundary | Every API input, agent callback, and persisted JSON validated |
| Secrets | Env only + pino redaction | Keys/tokens never logged or persisted; chain metadata in `config/public-chains.json` |

## Integration architecture

| External service | Purpose | Auth | Fallback |
|------------------|---------|------|----------|
| Somnia AgentRequester | Consensus-validated risk-review / heartbeat / distribution agents (on-chain LLM Inference) | on-chain, funded budget | Manual Telegram approval / manual execute |
| Telegram Bot API | Approval requests + signed quick actions | `TELEGRAM_BOT_TOKEN` | `DisabledTelegramClient` (no-op) when unset |
| Somnia Reactivity (0x0100) | Schedule inheritance distribution | precompile-gated | Manual `executeInheritance` after timelock |
| Supabase | Encrypted session keys + records | `SUPABASE_SERVICE_ROLE_KEY` | JSON file store (local/dev) |
| Blockscout (Shannon / Mainnet) | Token/NFT enumeration + approval discovery via indexed `getLogs` (full range; raw RPC `eth_getLogs` caps at 1000 blocks) + agent JSON/page sources | public (cloud explorer is rate-limited — use an API key / self-hosted for scale) | Degrade to agent snapshot / skip chain |
| Thirdweb | Smart-account AA + gas sponsorship | `THIRDWEB_SECRET_KEY` (backend) / `CLIENT_ID` (frontend) | — |

## Architecture decisions

Full rationale in [CONTEXT.md](CONTEXT.md). AD-N rows summarize; reference AD-N IDs in story Dev Notes.

| ID | Topic | Summary | Version | CONTEXT Ref |
|----|-------|---------|---------|-------------|
| AD-1 | pnpm workspace + focused starters | One repo, Next.js/agent/Foundry surfaces; Foundry for contracts | v0.1.0 | [D1](CONTEXT.md) |
| AD-2 | Risk intelligence is on-chain agent review (no off-chain LLM) | Somnia risk agent decides APPROVE/REJECT; Groq/DeepSeek removed; execution still gated by validator + signature | v0.1.0 | [D2](CONTEXT.md), [D11](CONTEXT.md) |
| AD-3 | Deterministic policy gates before signing | Every state-changing action returns an explicit allow/deny decision | v0.1.0 | [D3](CONTEXT.md) |
| AD-4 | Pivot to active ERC-7579 smart-account guard | From passive scoring to `validateUserOp` enforcement + revert-driven approval | v0.1.0 | [D4](CONTEXT.md) |
| AD-5 | Non-custodial living-vault inheritance | Funds stay in the user's smart account; registry stores policy only | v0.1.0 | [D5](CONTEXT.md) |
| AD-6 | Somnia Reactivity + Agents for inheritance | On-chain scheduling + consensus agents, not off-chain polling | v0.1.0 | [D6](CONTEXT.md) |
| AD-7 | Thirdweb for AA, ethers for agent | Frontend AA via thirdweb; backend reads/writes via ethers v6 | v0.1.0 | [D7](CONTEXT.md) |
| AD-8 | Supabase + JSON-store dual persistence | Encrypted session keys/users in Supabase; JSON store for local/dev | v0.1.0 | [D8](CONTEXT.md) |
| AD-9 | Telegram polling + signed callbacks | Polling for MVP reliability; HMAC + nonce + TTL replay protection | v0.1.0 | [D9](CONTEXT.md) |
| AD-10 | Public chain config is source of truth | `config/public-chains.json` for chain id/RPC/explorer/contracts | v0.1.0 | [D10](CONTEXT.md) |

## Open architecture questions

- [ ] Activate the ERC-7579 hook module once a ModularAccount variant runs hooks on the primary execute path (currently validator-only).
- [ ] Production database migration story beyond Supabase REST + JSON store.
- [ ] Telegram webhook deployment (currently polling-only).
- [ ] External audit before mainnet / high-value usage.
- [ ] Multi-chain support beyond Somnia Testnet.
