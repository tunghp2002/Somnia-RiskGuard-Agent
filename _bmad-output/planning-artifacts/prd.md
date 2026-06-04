---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
releaseMode: phased
inputDocuments:
  - docs/ARCHITECTURE.md
  - docs/CONTEXT.md
  - docs/riskguard-validation-module.md
  - README.md
documentCounts:
  productBriefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 4
workflowType: 'prd'
classification:
  projectType: blockchain_web3
  domain: fintech
  complexity: high
  projectContext: greenfield
revisionNote: 'Revised 2026-06-04 to match shipped MVP (active ERC-7579 guard; Supabase persistence; thirdweb AA; Reactivity-driven non-custodial inheritance).'
---

# Product Requirements Document - SomGuard

**Author:** tug
**Date:** 2026-06-04

> ### Revision note (2026-06-04)
>
> This PRD was revised to match the shipped MVP. The product **pivoted from
> passive LLM portfolio scoring to an active ERC-7579 smart-account guard**:
> risky transactions are now blocked on-chain at `validateUserOp` time and only
> proceed after a short-lived approval is recorded. **Off-chain LLM risk scoring
> (the former primary/fallback LLM providers, their env vars, the
> `POST /api/risk-snapshots/analyze` and `POST /api/telegram/test-alert`
> endpoints, and the Telegram risk-score alert) was removed**; risk intelligence
> now comes only from the on-chain Somnia risk agent review, whose APPROVE/REJECT
> decision never directly authorizes a transaction. Persistence runs on
> **Supabase** (with a JSON-store fallback for local/dev), account abstraction
> uses **Thirdweb** ERC-4337/7579 modular accounts, and the non-custodial
> inheritance ("dead man's switch") is driven by **Somnia Native On-Chain
> Reactivity plus consensus Somnia Agents** rather than off-chain polling.
> Authoritative sources: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md),
> [`docs/CONTEXT.md`](../../docs/CONTEXT.md),
> [`docs/riskguard-validation-module.md`](../../docs/riskguard-validation-module.md).

## Executive Summary

SomGuard is an **active on-chain smart-account guard** for Somnia
users who need protection when they are not actively watching their wallets.
RiskGuard runs as an ERC-7579 `RiskGuardValidator` module installed on a Thirdweb
modular smart account. Risky transactions — over-threshold native transfers,
batches, raw calldata / contract calls, and unlimited ERC-20 approvals — are
**blocked at `validateUserOp` time** and only proceed after a short-lived
approval has been recorded: either via Telegram user confirmation (written to the
`RiskGuardApprovalStore`, 10-minute TTL) or via a consensus-validated Somnia risk
agent (`requestAgentReview`). Alongside the guard, the product monitors portfolio
state, produces an **advisory** AI risk score and explanation (which never
authorizes anything), sends Telegram alerts with signed quick actions, performs
bounded routine automation such as small reward claims, and provides
non-custodial inheritance through a heartbeat-driven dead man's switch. The MVP
is built for Agentathon delivery: useful enough to demonstrate genuine agentic
on-chain enforcement, narrow enough to remain safe, and structured around
explicit user configuration rather than unrestricted autonomy.

### What Makes This Special

RiskGuard Agent does not merely observe or notify — it **enforces**. Standard
portfolio dashboards show balances and alert bots notify users after events;
RiskGuard blocks the dangerous transaction on-chain before it can execute, then
brings a human (via Telegram) or a consensus agent into the loop to authorize a
short-lived, one-time approval. Its core insight is twofold: crypto loss usually
happens in a single risky transaction (a drainer-style contract call, an
unlimited approval, a large transfer), and risk often materializes when users are
asleep, traveling, or distracted. The differentiator is the layered model — **Risk
= deterministic transaction rules / Guard = on-chain enforcement at validation
time / Agent = review, explanation, and approval coordination**. LLM analysis is
advisory and auditable, never an execution authority. The result is constrained,
trustworthy autonomy: the agent can monitor, explain, alert, claim small bounded
rewards, gate risky transactions, and run a non-custodial inheritance fallback,
without ever holding user funds or performing opaque autonomous trades.

## Project Classification

This is a greenfield `blockchain_web3` product in the `fintech` domain with high complexity. The complexity comes from on-chain transaction enforcement at ERC-4337 validation time, ERC-7579 module installation on a Thirdweb modular smart account, an off-chain-then-on-chain approval flow, AES-encrypted session-key handling, Telegram action authorization, consensus Somnia agent invocation, Reactivity-scheduled inheritance, and the need to prevent unsafe automation. The MVP must prioritize security, deterministic on-chain enforcement, explicit configuration, clear auditability, and non-custodial user trust (user funds never leave the user's smart account).

## Success Criteria

### User Success

A demo user can connect a browser wallet, set up a Thirdweb modular smart account, and install + configure the RiskGuard validator policy (transfer threshold, balance-percent, unlimited-approve, new-contract rules). When the user attempts a risky transaction it is **blocked on-chain** and the user is brought into an approval flow — confirming from Telegram or letting a Somnia agent review it — after which a resubmission succeeds. The user can also view portfolio status and an advisory AI risk score with plain-language explanations, configure a heartbeat and non-custodial inheritance plan with beneficiaries, and see the agent perform a constrained small reward claim. The user leaves the demo understanding that RiskGuard actively prevents the dangerous transaction rather than merely reporting on it.

### Business Success

The MVP is delivered within the Agentathon window and demonstrates a complete agentic enforcement loop: a risky transaction is blocked at validation time, an agent/user records a short-lived approval, and only then does execution proceed. The demo clearly shows smart-account setup, RiskGuard policy configuration, a blocked-then-approved transaction (both Telegram and agent-review paths), advisory risk analysis, a bounded reward claim, and the heartbeat → Reactivity-scheduled inheritance distribution. The project stands out as a practical Somnia Agentic L1 use case by emphasizing real on-chain enforcement and non-custody, not speculative automation. Success requires professional presentation, clear autonomy boundaries, and a security-first product narrative.

### Technical Success

The `RiskGuardValidator` reliably blocks risky UserOps with a `PendingApprovalRequired` revert and admits them only against a valid, unexpired, one-time approval from the `RiskGuardApprovalStore` or a Somnia agent. No synchronous external/LLM/Telegram/API call ever runs inside `validateUserOp`. The agent runtime monitors portfolio state, routes risky transactions to the on-chain Somnia risk agent review (APPROVE/REJECT), delivers signed Telegram quick actions, and runs four polled jobs (portfolio-monitor 30s, heartbeat-remind 60s, reward-claim 60s, riskguard-review 15s). State persists through typed repositories over Supabase with a JSON-store fallback; session keys are AES-encrypted at rest. Inheritance distribution is scheduled on-chain via Somnia Reactivity and approved by a consensus agent, with a manual `executeInheritance` fallback and no custody by the registry. The codebase maintains clean separation between `/agent`, `/frontend`, and `/contracts`, loads secrets only from env, keeps chain/contract metadata in `config/public-chains.json`, validates inputs with Zod at every boundary, and fails closed on invalid configuration.

### Measurable Outcomes

- A risky transaction is blocked on-chain at validation time and cannot execute without a recorded approval.
- An `RiskGuardApprovalStore` approval is valid for a 10-minute TTL and is consumed exactly once.
- Risky transactions are reviewed by the on-chain Somnia risk agent (`requestAgentReview` → `handleRiskAssessmentResponse`), which returns an APPROVE/REJECT decision recorded on-chain; the decision never directly authorizes a transaction.
- Reward-claim automation only executes when auto-claim is enabled and reward ≥ min / gas ≤ max pass; the policy decision expires after 60s.
- Inheritance distribution moves funds from the user's smart account (never from the registry) only after on-chain heartbeat expiry plus timelock, with stale schedules skipped.
- Contract tests cover the validator (agent review → approval → allowed UserOp) and the inheritance registry (plan lifecycle, heartbeat refresh, Reactivity schedule + stale-skip, beneficiary timelock, agent heartbeat/distribution, skip-on-fail, share integrity).
- No secrets are committed; agent signer key, encryption key, and API tokens load only from environment variables, while public chain/contract metadata comes from `config/public-chains.json`.

## Product Scope

### MVP - Minimum Viable Product

The MVP includes: a Thirdweb ERC-7579 modular smart account with the `RiskGuardValidator` module installed; user-configurable guard rules (over-threshold native transfer, balance-percent, unlimited ERC-20 approve, new-contract interaction); on-chain blocking of risky transactions at `validateUserOp` time via a `PendingApprovalRequired` revert; an off-chain-then-on-chain approval flow through Telegram confirmation (`RiskGuardApprovalStore`, 10-minute TTL) and/or a consensus Somnia risk agent (`requestAgentReview`); portfolio monitoring with advisory AI risk analysis; Telegram alerts with HMAC-signed quick-action buttons; heartbeat configuration and a non-custodial inheritance dead man's switch; bounded auto-claiming of small rewards; and a dashboard (overview / transfer / profile / inheritance) for setup and status.

### Growth Features (Post-MVP)

Post-MVP work includes activating the experimental ERC-7579 hook module once a ModularAccount variant runs hooks on the primary execute path, richer/auto-tuned guard rules, advanced rebalancing and auto-swap flows, multi-chain support beyond Somnia Testnet, advanced sentiment analysis and richer risk models, Telegram webhook deployment (currently polling-only), and a production database story beyond Supabase REST + JSON store. These are excluded from the MVP because they increase automation risk or operational scope and are not required to prove the Agentathon concept.

### Vision (Future)

The long-term vision is a personal AI safety and continuity suite on Somnia: an always-on agent that combines on-chain transaction guarding, portfolio intelligence, bounded safe automation, and non-custodial inheritance/continuity planning — all while preserving user control, non-custody, and auditability.

### Smart Account Direction

RiskGuard is built on a Thirdweb ERC-4337/ERC-7579 modular smart account. The `RiskGuardValidator` (module type 1) is installed alongside Thirdweb's `DefaultValidator` (owner signatures) and is what actually enforces the guard at validation time. The experimental `RiskGuardHookModule` (module type 4) implements the same policy via `preCheck`/`postCheck`, but Thirdweb's ModularAccount does not run hooks on its primary execute path, so the **validator is the active guard** in the MVP.

Inheritance uses a non-custodial **living-vault** model, not a standalone locked deposit vault. User assets stay in the user's smart account and remain usable day to day; the `RiskGuardInheritanceRegistry` stores only the inheritance *policy* and state (beneficiaries by bps, protected assets, heartbeat/grace/timelock). When the dead man's switch fires, distribution transfers assets **from** the user's smart account by share; the registry never custodies funds. EOAs cannot create plans (no `executeBatch`), so the smart account is the required account model. A "standalone deposit vault" is explicitly **not** a user-facing path.

## User Journeys

### Journey 1: Alex Configures RiskGuard And Acts From A Blocked Transaction

Alex Chen is a 32-year-old crypto holder and DeFi user on Somnia. He holds significant assets, works full time, and travels often. He opens the RiskGuard dashboard, connects his browser wallet, and sets up a Thirdweb modular smart account. He installs the `RiskGuardValidator` module and configures his guard rules — a native-transfer threshold, a balance-percent limit, the unlimited-approve rule, and the new-contract-interaction rule. He links Telegram via the connect flow.

Later, Alex (or something acting through his account) attempts a risky transaction — a large native transfer, an unlimited token approval, or a call to an unknown contract. The `RiskGuardValidator` **blocks it on-chain** at `validateUserOp` time with a `PendingApprovalRequired` revert. The agent reads the revert data, decodes the target/value/calldata, and sends Alex a Telegram message with signed approve/reject buttons explaining exactly what was attempted and why it triggered a rule. Alex approves; the agent's session-key signer writes a short-lived (10-minute) approval to the `RiskGuardApprovalStore`. Alex resubmits and the transaction now passes validation and executes once.

The value moment is that RiskGuard **stopped** the dangerous transaction before it could execute and put Alex in control. This journey requires smart-account setup, validator install + policy config, revert-driven detection, Telegram linking, signed quick-action authorization, and the on-chain approval store.

### Journey 2: Alex Misses Heartbeats And Inheritance Distributes

Alex creates a non-custodial inheritance plan on his smart account: beneficiaries by share (bps), the protected assets, and heartbeat/grace/timelock parameters. The registry schedules a distribution via Somnia Reactivity at the timelock end. The dashboard shows the next heartbeat deadline and explains that distribution is non-custodial and only fires after on-chain expiry plus timelock.

Alex stays active by checking in (`checkIn()`) or by the agent's `triggerAgentHeartbeat()`, each of which refreshes the deadline. RiskGuard sends Telegram reminders before expiry. If Alex stops responding and the heartbeat expires, the Reactivity precompile (`0x0100`) calls `onEvent()`, which requests the Somnia distribution agent; on a consensus response, `_executeDistribution()` transfers each protected asset to beneficiaries by share **from Alex's smart account**. A manual `executeInheritance()` fallback remains and fails closed.

The climax is safe, on-chain, non-custodial activation — funds never touch the registry. The journey succeeds only if reminders are clear, false triggers are prevented by the on-chain expiry + timelock gate, stale schedules are skipped on a refreshed heartbeat, and beneficiary shares stay integrity-checked.

### Journey 3: Sarah Uses The Beneficiary-Safe Path

Sarah Chen is Alex's beneficiary and is not highly technical. She is reachable through the beneficiary-safe status surface (`/api/heartbeats/beneficiary-status`) and clear messaging. She can see whether Alex's heartbeat is still active, whether expiry and the timelock have passed, and which assets/shares are configured for her — without being asked to make ambiguous or dangerous choices.

Because distribution is automated on-chain (Reactivity + consensus agent), Sarah does not need to execute a risky transaction herself; the system tells her plainly what state the plan is in and when distribution can or did occur, with the manual `executeInheritance()` only as a gated fallback. The value moment is Sarah feeling informed and guided rather than overwhelmed. This journey requires simple beneficiary-status messaging, clear timelock/expiry visibility, and strong guardrails against accidental or premature execution.

### Journey 4: RiskGuard Claims Small Rewards Under Policy

Alex enables auto-claim and sets a minimum reward value and a maximum gas cost. The `reward-claim` job (every 60s) calls `RewardClaimService.run()`, which detects claimable rewards and runs them through the `reward-claim-policy`: it requires the claim action, auto-claim enabled, reward ≥ min, gas ≤ max, and the resulting policy decision expires after 60s. If the reward qualifies, the agent executes the claim and records an audit event; if not, it skips and records why.

Alex receives a Telegram notification describing the outcome. The journey proves the agent can take useful, bounded on-chain action without expanding into unrestricted trading. It requires reward detection, the deterministic reward-claim policy gate, execution via the session-key/agent signer, audit logging, and Telegram reporting.

### Journey 5: Developer Demonstrates The Full Agentathon Flow

The developer prepares a judge-facing demo using the deterministic demo scenarios (`/api/demo/scenarios`) and seeded fixtures (e.g. reward fixtures via `/api/rewards/fixtures`). The demo shows smart-account setup, RiskGuard validator install + policy config, and a **risky transaction blocked on-chain** — then the two approval paths: a Telegram-confirmed `RiskGuardApprovalStore` approval, and a Somnia agent review (`requestAgentReview` → `handleRiskAssessmentResponse`) whose result the `riskguard-review` job (every 15s) surfaces back to Telegram. It then shows advisory AI risk analysis, a bounded reward claim, and the heartbeat → Reactivity-scheduled inheritance distribution.

The demo ends with the audit-events timeline proving each state-changing attempt recorded signer, chain ID, target, calldata summary, and outcome. This journey requires deterministic demo scenarios/fixtures, clear blocked-vs-approved transaction boundaries, visible audit logs, and a polished narrative judges can follow quickly.

### Journey 6: Operator Troubleshoots And Checks Health

During testing or demo prep, the operator notices a Telegram alert did not arrive, a Somnia agent review stalled, or a transaction reverted. The operator checks the health endpoints (`/api/health`, `/api/telegram/health`) and the recent audit events (`/api/audit-events/recent`) to see which subsystem failed: portfolio monitoring, Telegram polling, Somnia RPC/agent, Supabase vs JSON-store persistence, session-key signer, or contract interaction.

The system gives structured, secret-safe diagnostics (pino redaction). If the Somnia agent review stalls, the manual Telegram approval path remains; if Telegram has no bot token, the `DisabledTelegramClient` no-ops; if Supabase is unavailable, the JSON store is used for local/dev. This journey requires audit-friendly logging, exposed provider/health state, explicit fail-closed error handling, and diagnostics that never leak secrets.

### Journey Requirements Summary

These journeys reveal the core capability areas for the MVP: smart-account setup and RiskGuard validator install/config; on-chain blocking of risky transactions with revert-driven detection; the off-chain-then-on-chain approval flow via Telegram and/or Somnia agents; portfolio monitoring with advisory AI analysis; signed Telegram alerts and quick actions; heartbeat configuration and non-custodial Reactivity-driven inheritance; beneficiary-safe status; bounded reward-claim automation; deterministic demo scenarios; and secret-safe audit logging and health. They establish the product's safety boundary: the agent may guard, monitor, explain, notify, claim small policy-bounded rewards, and run a non-custodial inheritance fallback, but it must never let LLM output authorize a transaction, custody user funds, or perform unrestricted trades or unbounded transfers.

## Domain-Specific Requirements

### Compliance & Regulatory

- The MVP must not present itself as licensed financial advice, investment management, or guaranteed asset protection.
- AI risk-score output must be framed as informational, advisory analysis — never a directive to buy, sell, or trade, and never an authorization to execute.
- The agent must require explicit user configuration (guard rules, heartbeat, inheritance plan, auto-claim limits) before any enforcement or on-chain action.
- Inheritance must operate only as a non-custodial living vault: funds stay in the user's smart account, and distribution fires only via on-chain expiry + timelock through pre-configured beneficiary rules.
- The demo must run on Somnia Testnet (chainId 50312, STT) and avoid real high-value assets.

### Technical Constraints

- Secrets — agent signer key, `SESSION_KEY_ENCRYPTION_KEY`, bot token, Supabase service-role key, Thirdweb secret key — must only be loaded from environment variables.
- Non-secret chain/contract metadata (chain ID, RPC URL, explorer URL, native currency, deployed contract addresses) must be loaded from `config/public-chains.json`, not env.
- The `RiskGuardValidator` must enforce policy deterministically inside `validateUserOp` with **no** synchronous external (LLM/Telegram/API) call; off-chain agent work happens before resubmission.
- Approvals must be short-lived and one-time: the `RiskGuardApprovalStore` enforces a 10-minute TTL and single-use consumption; agent approvals expire.
- On-chain agent actions (reward claims, deadman check-in) must be bounded by deterministic policy gates carrying signer, chainId, target, and calldata summary.
- Telegram quick actions must be HMAC-SHA256-signed with a nonce and TTL, bound to a wallet↔chat pairing; replayed/expired/forged callbacks fail closed.
- The system must keep audit-friendly records (`audit-events`) of analysis, alerts, approvals, skipped/attempted/failed/successful actions.
- The on-chain Somnia agent review (APPROVE/REJECT) must never directly authorize execution; on-chain validation + a user/agent signature hold all execution authority.

### Integration Requirements

- The backend agent integrates with Somnia RPC, contracts, and events through ethers v6; the frontend uses Thirdweb for ERC-4337/7579 account abstraction and gas sponsorship.
- Risk analysis runs entirely on-chain via the Somnia risk agent (`RiskGuardValidator.requestAgentReview` → `handleRiskAssessmentResponse`); there is no off-chain LLM provider.
- Telegram integration runs via long-polling (`getUpdates`) with signed quick-action buttons; a `DisabledTelegramClient` no-ops when no token is set.
- Persistence uses Supabase (encrypted session keys + `users` + `agent_records`) with a JSON-store fallback for local/dev and tests, behind a single `RepositoryStore<T>` contract.
- Asset/NFT enumeration uses Blockscout (Shannon explorer), degrading to the agent snapshot.
- Somnia consensus agents are invoked on-chain (`IAgentRequester.createRequest`) for risk review, heartbeat liveness, and distribution, with platform-gated callbacks.
- The inheritance registry and validator must expose heartbeat, expiry, timelock, beneficiary, plan, and pending-approval state that the agent and dashboard can read reliably.

### Risk Mitigations

- False inheritance activation is prevented by an on-chain heartbeat-expiry + timelock gate (not off-chain judgement), heartbeat-refresh stale-schedule skipping, and Telegram reminders before expiry.
- Unsafe autonomous behavior is prevented by blocking risky transactions at validation time and excluding unrestricted trading, arbitrary transfers, and unbounded strategy execution from the MVP.
- Failed RPC, Telegram, Somnia agent, or transaction flows fail closed and produce secret-safe diagnostics.
- Reward claiming executes only when auto-claim is enabled and reward ≥ min / gas ≤ max pass; the decision expires after 60s.
- Contract behavior is covered by tests for the validator (agent review → approval → allowed UserOp) and the inheritance registry (plan lifecycle, heartbeat refresh, Reactivity schedule + stale-skip, beneficiary timelock, agent heartbeat/distribution, skip-on-fail, share integrity).

## Innovation & Novel Patterns

### Detected Innovation Areas

The core novel pattern is **on-chain risk enforcement at ERC-4337 validation time**: the `RiskGuardValidator` (an ERC-7579 module on a Thirdweb modular account) blocks risky transactions in `validateUserOp` and admits them only against a short-lived, one-time approval recorded off-chain-then-on-chain. This realizes a clean separation — **Risk = deterministic transaction rules / Guard = on-chain enforcement / Agent = review, explanation, and approval coordination** — while respecting ERC-4337's requirement that validation stay bounded and deterministic (no LLM or external call inside validation).

The second novel area is **non-custodial, decentralized continuity**: the inheritance dead man's switch is scheduled and fired by Somnia Native On-Chain Reactivity (`0x0100` precompile) and approved by consensus-validated Somnia Agents, with funds always remaining in the user's smart account. This treats continuity as a trustless on-chain problem rather than an off-chain cron with a privileged server.

### Market Context & Competitive Landscape

Typical portfolio trackers focus on visibility and alert bots on notifications; DeFi automation tools optimize yield or trading. RiskGuard's position is different: it **prevents** the loss-causing transaction on-chain and provides non-custodial continuity. For the Agentathon MVP, the product avoids claiming to replace custody, financial advisors, or estate-planning products; its defensible position is a practical Somnia-native agent that demonstrates real on-chain enforcement plus consensus-agent + Reactivity-driven continuity.

### Validation Approach

Validation is a complete demo loop: smart-account setup, validator install + policy config, a risky transaction blocked on-chain, approval via both the Telegram (`RiskGuardApprovalStore`) and Somnia agent (`requestAgentReview`) paths, advisory AI analysis, a bounded reward claim, and heartbeat → Reactivity-scheduled inheritance distribution. Contract tests back the validator and registry. The demo must prove the agent can act without becoming unsafe: enforcement is on-chain, approvals are short-lived and one-time, LLM output is advisory, and every state-changing attempt is logged.

### Risk Mitigation

The main risk is user trust. The MVP mitigates it by making enforcement deterministic and on-chain, keeping LLM output advisory (it can never authorize a transaction), keeping the product non-custodial (funds never leave the user's smart account), making approvals short-lived and single-use (10-minute TTL), signing Telegram callbacks with HMAC + nonce + TTL, gating inheritance on on-chain expiry + timelock, and failing closed with secret-safe diagnostics on any provider/transaction failure.

## Blockchain Web3 Specific Requirements

### Project-Type Overview

SomGuard is a Somnia Testnet Web3 agent product with deterministic demo scenarios for Agentathon judging. The system combines a browser-connected EOA, a Thirdweb ERC-4337/7579 modular smart account, an ERC-7579 `RiskGuardValidator` guard module, an `RiskGuardApprovalStore`, a non-custodial `RiskGuardInheritanceRegistry`, consensus Somnia agents, Somnia Reactivity scheduling, and a Node/TS agent runtime using ethers v6. The MVP proves on-chain enforcement and non-custodial continuity without implying production custody, financial advice, or unrestricted asset management.

### Technical Architecture Considerations

The frontend dashboard connects a browser wallet (EOA) and provisions a Thirdweb modular smart account (deterministic `riskGuardAccountSalt`) with gas sponsorship. It handles wallet connect, RiskGuard module install + policy config, native transfers (with agent-review handling), profile/Telegram connect, and inheritance plan building. It never holds or stores private keys.

The backend agent uses an env-loaded signer plus AES-encrypted session keys (stored encrypted in Supabase) to write on-chain approvals, run bounded actions, and read contract state via ethers v6. The smart account itself executes user transactions (subject to the validator); the agent's authority is bounded by deterministic policy gates and the on-chain approval store. Frontend, agent, and contract responsibilities remain clearly separated.

Account abstraction is the required model: a smart account can execute native and ERC-20 calls from itself, which is what makes both the guard (validation-time enforcement) and non-custodial inheritance (distribution from the account) possible. Gas sponsorship reduces onboarding/check-in friction but is never spending authority.

### Chain Specs

- Primary network: **Somnia Testnet**, chainId **50312**, native token **STT**.
- RPC: `https://dream-rpc.somnia.network`. Explorer: `https://shannon-explorer.somnia.network` (Shannon / Blockscout).
- Chain ID, RPC URL, explorer URL, native currency metadata, and deployed contract addresses are tracked in **`config/public-chains.json`** (default `somnia-testnet`); secrets and optional overrides remain env-driven.
- The agent uses ethers v6 for provider, signer, contract, and event interactions; the frontend uses Thirdweb for AA.
- Deterministic demo scenarios and seeded fixtures support repeatable judging flows.
- The system fails closed when RPC configuration, chain ID, signer, or contract-address validation fails.

### Wallet Support

- Frontend connects a **browser wallet (EOA)** via injected EVM providers and provisions a **Thirdweb ERC-4337/7579 modular smart account** (gas sponsored).
- The frontend never requests, holds, or stores private keys.
- The agent uses an **env-loaded signer** plus **AES-encrypted session keys** (32-byte `SESSION_KEY_ENCRYPTION_KEY`) persisted encrypted in Supabase, used to write approvals and run bounded actions.
- Wallet addresses are checksum-validated; signed-message proofs gate wallet-mutating API endpoints.
- On-chain agent actions always pass deterministic policy checks before signing.

### Smart Contracts

Foundry project, **Solidity 0.8.35** (`via_ir`, 200 runs), **OpenZeppelin Contracts 5.6.1**. ERC-7579 modules are installed on a **Thirdweb ModularAccount** (factory + `DefaultValidator` for owner signatures). Addresses are tracked in `config/public-chains.json`.

- **`RiskGuardInheritanceRegistry`** (`src/InheritanceRegistry.sol`, `ReentrancyGuard`) — non-custodial inheritance / dead man's switch. One plan per smart account: beneficiaries (addr + bps), protected assets, heartbeat/grace/timelock, `checkIn`, beneficiary-change timelock, Reactivity-scheduled + agent-confirmed distribution, and a manual `executeInheritance` fallback. Funds move from the smart account; the registry never custodies.
- **`RiskGuardValidator`** (`src/riskguard/RiskGuardValidator.sol`) — ERC-7579 validator (module type 1). Enforces risk policy in `validateUserOp`: safe sub-threshold native transfers pass; batches, calldata, contract recipients, and over-threshold value are blocked via `PendingApprovalRequired`; consumes `RiskGuardApprovalStore` approvals or Somnia agent approvals; exposes `requestAgentReview` + `handleRiskAssessmentResponse`. **This is the active guard.**
- **`RiskGuardHookModule`** (`src/riskguard/RiskGuardHookModule.sol`) — ERC-7579 hook (module type 4). Same policy via `preCheck`/`postCheck`; **experimental** — Thirdweb's ModularAccount does not run hooks on its primary execute path, so the validator is the active enforcement point.
- **`RiskGuardApprovalStore`** (`src/riskguard/RiskGuardApprovalStore.sol`) — bridges agent/Telegram approvals on-chain: `registerAgentAndHook`, `submitApproval`, `consumeApproval`, **10-minute TTL**, one-time use.
- **`SomniaAgentInterfaces.sol`** — `IAgentRequester` / `IAgentRequesterHandler`, `Request`/`Response`/`ResponseStatus`/`ConsensusType` for Somnia agent invocation + callbacks.

Contracts prioritize readable, secure implementation; extreme gas optimization is not required for the MVP.

### Security Audit Posture

The MVP requires internal code review and automated tests. Production, mainnet deployment, or high-value usage requires an external smart-contract and system security audit. Test coverage includes `test/RiskGuardValidator.t.sol` (agent review request → approval → allowed UserOp) and `test/InheritanceRegistry.t.sol` (plan lifecycle, heartbeat refresh, Reactivity schedule + stale-skip, beneficiary timelock, agent heartbeat/distribution, skip-on-fail, share integrity).

### Gas Optimization

Gas usage should be reasonable, but security, readability, and bounded/deterministic `validateUserOp` behavior take priority. Avoid unnecessary storage writes and unbounded loops; do not introduce gas-saving patterns that reduce auditability or break ERC-4337 validation constraints.

### Implementation Considerations

The MVP maintains hard separation between frontend (AA setup + UX), agent runtime (reads/writes/approvals via ethers), and contract-enforced safety. Config is Zod-validated and fails closed at startup. All state-changing attempts are logged with signer, chainId, target, and calldata summary, with pino secret redaction. LLM output never controls transactions. Every agent reward/heartbeat action is gated by a deterministic policy decision, and every risky smart-account transaction is gated on-chain by the validator and a short-lived, one-time approval.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Enforcement-and-safety MVP. The first release must prove that SomGuard can actually guard funds: block a risky transaction on-chain at validation time, coordinate a short-lived approval (Telegram or Somnia agent), let it proceed once, and demonstrate non-custodial inheritance continuity — alongside advisory monitoring and bounded reward automation.

**Resource Requirements:** MVP delivery requires one full-stack developer/operator with smart-contract capability, plus focused QA/security review. Core skills: Node.js/TypeScript (NodeNext ESM), Next.js + Thirdweb AA, Solidity + Foundry, ERC-4337/ERC-7579 modules, ethers v6, Supabase, Telegram bot integration, Somnia on-chain agent integration, and Web3 security testing.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- Alex sets up a smart account, installs RiskGuard, attempts a risky transaction that is blocked on-chain, and approves it via Telegram or a Somnia agent.
- Alex misses heartbeats and the non-custodial inheritance distributes from his smart account after on-chain expiry + timelock.
- Sarah sees the beneficiary-safe status without making dangerous choices.
- RiskGuard auto-claims small rewards under the deterministic reward-claim policy.
- The developer demonstrates blocked-then-approved transactions, advisory analysis, reward claim, and inheritance to judges.
- The operator diagnoses failed Telegram, Somnia agent, RPC, or persistence flows without exposing secrets.

**Must-Have Capabilities:**
- Thirdweb ERC-7579 modular smart account with the `RiskGuardValidator` installed and configurable guard rules.
- On-chain blocking of risky transactions (`PendingApprovalRequired`) and the off-chain-then-on-chain approval flow (`RiskGuardApprovalStore` 10-min TTL + Somnia `requestAgentReview`).
- Portfolio monitoring, with risky-transaction risk review handled on-chain by the Somnia risk agent (no off-chain LLM provider).
- Telegram alerts with HMAC-signed quick-action buttons and the connect flow.
- Heartbeat configuration and a non-custodial inheritance dead man's switch (Reactivity-scheduled + consensus-agent-approved, manual fallback).
- Bounded auto-claim of small rewards gated by the reward-claim policy.
- Dashboard (overview / transfer / profile / inheritance) for setup and status.
- Supabase persistence with JSON-store fallback; AES-encrypted session keys; env-only secrets.
- Audit-friendly logs for analysis, alerts, approvals, skipped/executed actions.
- Foundry tests for the validator and inheritance registry.

### Post-MVP Features

**Phase 2 (Post-MVP):**
- Activate the ERC-7579 hook module once a ModularAccount variant runs hooks on the primary execute path.
- Richer / auto-tuned guard rules and more granular approval workflows.
- Advanced rebalancing and auto-swap flows; richer risk intelligence / sentiment.
- Multi-chain support beyond Somnia Testnet.
- Telegram webhook deployment (currently polling-only).
- Production database story beyond Supabase REST + JSON store; expanded dashboard analytics.

**Explicitly Out Of MVP:**
- Full autonomous trading, arbitrary transfers, unbounded rebalancing.
- LLM-authorized execution of any kind.
- Mainnet / high-value production usage and external audit completion.
- Licensed financial advice or custody claims.
- Standalone locked deposit vault for inheritance.

### Future Vision

**Phase 3 (Expansion):**
Somnia RiskGuard evolves into a personal on-chain safety and continuity suite on Somnia, combining transaction guarding, portfolio intelligence, bounded safe automation, and non-custodial continuity planning while preserving user control, non-custody, and auditability.

### Risk Mitigation Strategy

**Technical Risks:** The highest-risk areas are smart-contract safety (validator + registry), bounded/deterministic `validateUserOp` behavior, approval freshness/replay, false inheritance activation, Telegram action authentication, and over-trusting model output. The MVP mitigates these via on-chain enforcement with no external calls in validation, short-lived one-time approvals, on-chain expiry + timelock gating, HMAC + nonce + TTL signed callbacks, an on-chain agent review whose APPROVE/REJECT never directly authorizes a transaction, fail-closed behavior, and Foundry tests.

**Market Risks:** Users may distrust automated crypto agents if autonomy feels opaque or dangerous. The MVP addresses this through real on-chain enforcement, non-custody, clear explanations, explicit setup, and visible audit logs rather than yield or trading promises.

**Resource Risks:** The Agentathon timeline requires a lean implementation. If time compresses, preserve the core enforcement demo first: smart-account setup, validator install, a blocked-then-approved transaction (both paths), and inheritance distribution. Broader integrations and the hook module can wait.

## Functional Requirements

### Wallet, User Config & Smart-Account Setup

- FR1: Users can connect a browser wallet (EOA) to identify and operate their Somnia account.
- FR2: Users can provision a Thirdweb ERC-4337/7579 modular smart account (gas sponsored, deterministic salt).
- FR3: Users can install the `RiskGuardValidator` module on the smart account and view setup/readiness.
- FR4: Users can configure RiskGuard guard rules: native-transfer threshold, balance-percent limit, unlimited-approve rule, and new-contract-interaction rule.
- FR5: Users can register a monitored wallet and update their profile (display name) with a signed-message proof.
- FR6: Users can configure heartbeat parameters (interval/grace/timelock) and a non-custodial inheritance plan (beneficiaries by bps, protected assets).
- FR7: Users can enable/disable auto-claim and set minimum reward value and maximum gas cost.

### Portfolio Monitoring & On-Chain Agent Risk Review

- FR8: The agent monitors configured wallet portfolio state on Somnia (every 30s) and enumerates assets via Blockscout.
- FR9: The agent detects portfolio/reward/risk-signal changes and persists risk snapshots (sourced from demo scenarios / on-chain agent review) and audit events; there is no off-chain LLM scoring step.
- FR10: Risky transactions are reviewed by the on-chain Somnia risk agent (`requestAgentReview` → `handleRiskAssessmentResponse`), which returns an APPROVE/REJECT decision recorded on-chain.
- FR11: The agent presents the agent-review decision and triggered rule in plain language; the decision never directly authorizes a transaction.
- FR12: The on-chain agent review is the single risk-intelligence source; if it stalls, the manual Telegram approval path remains available.
- FR13: Users can view current portfolio status, the latest risk snapshot, and recent audit events.

### RiskGuard Active Transaction Guard & Approval Flow

- FR14: The `RiskGuardValidator` blocks risky transactions at `validateUserOp` time — over-threshold native transfers, batches, raw calldata/contract calls, and unlimited approvals — via a `PendingApprovalRequired` revert, while allowing safe sub-threshold native transfers.
- FR15: The agent reads the revert data (not an event), decodes target/value/calldata, and initiates an approval request.
- FR16: A blocked transaction can be approved via Telegram confirmation, recording a short-lived approval (10-min TTL) in the `RiskGuardApprovalStore` through the session-key signer.
- FR17: A blocked transaction can instead be reviewed by a consensus Somnia risk agent (`requestAgentReview` → `handleRiskAssessmentResponse`), which records an agent approval.
- FR18: On resubmission the validator admits the transaction only against a valid, unexpired, one-time approval, which is consumed exactly once.
- FR19: The `riskguard-review` job (every 15s) polls review-completion events and notifies the bound Telegram chat of the decision.

### Telegram Alerts & Signed Quick Actions

- FR20: The agent sends Telegram alerts (risk, approval requests, reward outcomes, heartbeat reminders) when conditions occur.
- FR21: Alerts include clear text and HMAC-SHA256-signed quick-action buttons carrying a nonce and TTL, bound to a wallet↔chat pairing.
- FR22: Users can link/unlink Telegram via the connect flow (start/status/confirm) and signed bindings.
- FR23: Users can approve or reject blocked transactions and supported safe actions from Telegram.
- FR24: The system rejects unauthorized, expired, replayed, or forged Telegram callbacks (fail closed).
- FR25: When no bot token is configured, a `DisabledTelegramClient` no-ops without breaking the runtime.

### Heartbeat & Non-Custodial Inheritance

- FR26: Users can create/update heartbeat settings and perform check-ins (`checkIn`, signed); the agent can also `triggerAgentHeartbeat`.
- FR27: The heartbeat job (every 60s) evaluates reminders and sends Telegram reminders before expiry.
- FR28: A check-in or agent heartbeat refreshes the deadline; stale Reactivity schedules are skipped.
- FR29: The system exposes heartbeat status, expiry, timelock, plan, and beneficiary-safe status.
- FR30: On heartbeat expiry, the Reactivity precompile (`0x0100`) triggers `onEvent`, which requests the Somnia distribution agent.
- FR31: After timelock and a consensus agent response, `_executeDistribution` transfers each protected asset to beneficiaries by share **from the user's smart account**; the registry never custodies funds.
- FR32: A manual `executeInheritance` fallback exists and fails closed; the deadman policy requires beneficiary==requester, contract ready, heartbeat expired, timelock complete, not already executed.

### Safe Reward-Claim Automation

- FR33: The reward-claim job (every 60s) identifies claimable rewards for configured wallets.
- FR34: The reward-claim policy gates execution: claim action, auto-claim enabled, reward ≥ min, gas ≤ max; the decision expires after 60s.
- FR35: The agent executes eligible claims via the session-key/agent signer and skips ineligible ones with a recorded reason.
- FR36: The system records each skipped, attempted, failed, or successful action as an audit event and reports outcomes to Telegram.

### Dashboard, Demo Scenarios & Operator Visibility

- FR37: Users can view setup state, portfolio overview, RiskGuard policy status, transfers, profile/Telegram, and inheritance plan across the dashboard's four sections.
- FR38: The operator can run deterministic demo scenarios (`/api/demo/scenarios`) and seed fixtures (e.g. reward fixtures) for repeatable judging.
- FR39: The operator can view subsystem health (`/api/health`, `/api/telegram/health`) for Telegram, Somnia, and public-chain config.
- FR40: The operator can inspect secret-safe audit events for analysis, alerts, approvals, policy decisions, and transaction outcomes.

### Security & Safety Controls

- FR41: The system validates required runtime configuration with Zod and fails closed before agent startup.
- FR42: The system fails closed when required providers, signer, contracts, persistence, or policy checks are invalid.
- FR43: The frontend never holds private keys; the agent signer + session keys are env-loaded / AES-encrypted in Supabase, kept separate from user wallets.
- FR44: No state-changing agent action is signed without a deterministic policy decision; no risky smart-account transaction executes without on-chain validation + a short-lived one-time approval.
- FR45: The system records audit-friendly action history (signer, chainId, target, calldata summary, outcome) without revealing secrets (pino redaction).
- FR46: AI risk output is framed as informational, advisory analysis rather than financial advice.

## Non-Functional Requirements

### Performance

- `validateUserOp` must run bounded, deterministic on-chain work with no synchronous external (LLM/Telegram/API) calls.
- The on-chain Somnia risk agent review should resolve and surface its APPROVE/REJECT decision promptly under normal demo conditions, with the `riskguard-review` job (15s) relaying it to Telegram.
- Background jobs run on fixed intervals (portfolio-monitor 30s, heartbeat-remind 60s, reward-claim 60s, riskguard-review 15s).
- Telegram alerts and approval requests should be delivered promptly after a detected event or revert.
- Dashboard status (overview, policy, heartbeat, inheritance) should refresh quickly enough that demo users understand current state without log inspection.

### Security

- Secrets — agent signer key, `SESSION_KEY_ENCRYPTION_KEY`, bot token, Supabase service-role key, Thirdweb secret key — must only be loaded from environment variables.
- The frontend must never request, store, or transmit private keys; session keys are AES-encrypted at rest in Supabase.
- The agent signer and session keys must remain separate from user wallets; the registry must never custody funds.
- The on-chain Somnia agent review must never directly authorize a transaction; on-chain validation + a user/agent signature hold all execution authority.
- Risky smart-account transactions must be blocked on-chain and admitted only against a valid, unexpired, one-time approval (10-min TTL).
- Agent state-changing actions must pass a deterministic policy decision before signing.
- Telegram quick actions must be HMAC-SHA256-signed with nonce + TTL and wallet↔chat binding; replays/forgeries fail closed.
- Logs must not expose secrets or sensitive payloads (pino redaction).
- Production, mainnet, or high-value usage requires an external security audit before launch.

### Reliability

- The agent must fail closed when required configuration, RPC, signer, contract addresses, or persistence is invalid.
- A stalled Somnia agent review leaves the manual Telegram approval path available; Supabase unavailability falls back to the JSON store for local/dev; missing bot token degrades to a no-op Telegram client.
- Failed Telegram, RPC, Somnia agent, or transaction flows must produce actionable, secret-safe diagnostics.
- Inheritance activation must be gated by on-chain heartbeat expiry + timelock with reminders and stale-schedule skipping to prevent false activation.
- Reward-claim automation must skip execution when policy checks fail.

### Integration

- Somnia RPC/agents, Telegram, Supabase, Blockscout, and contract integrations must expose health or fail state to the operator.
- Non-secret chain/contract metadata (chain ID, RPC, explorer, native currency, contract addresses) must come from `config/public-chains.json`; secrets and optional overrides remain env-driven.
- Deterministic demo scenarios and fixtures must support repeatable judging flows.
- The agent and dashboard must read validator/registry state consistently for guard policy, pending approvals, heartbeat, expiry, timelock, beneficiary, plan, and distribution status.

### Accessibility

- Dashboard flows must use clear labels and status text for setup, guard policy, heartbeat, risk, transfers, and inheritance.
- Beneficiary-facing messages must avoid technical jargon and clearly explain current status, waiting periods, and what happens next.
- Critical alerts must not rely on color alone to communicate severity.

### Maintainability

- Agent, frontend, and contracts must remain separated under `/agent`, `/frontend`, and `/contracts` in one pnpm workspace.
- Policy modules must be unit-testable independently from the on-chain agent review and Telegram delivery.
- Foundry tests must cover the validator (agent review → approval → allowed UserOp) and the inheritance registry (plan lifecycle, heartbeat refresh, Reactivity schedule + stale-skip, beneficiary timelock, agent heartbeat/distribution, skip-on-fail, share integrity).
- The codebase must use typed configuration and Zod validation at every boundary to prevent invalid runtime states.
