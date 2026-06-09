# CONTEXT — SomGuard

> Decision log. **Append-only (RULE-7)**: never rewrite a past decision —
> add a revision entry that references the original by ID. Each decision has
> a matching `AD-N` summary row in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Phase 0 — Planning (2026-05-10 → 2026-05-11, pre-v0.1.0)

### D1. pnpm workspace with focused per-surface starters

**Context**: The product needs three distinct runtimes — a long-running agent, a
dashboard, and smart contracts — that a single full-stack starter models poorly.

**Decision**: One root pnpm workspace with `agent` (Node/TS), `frontend`
(Next.js + shadcn/ui), and `contracts` (Foundry) as workspaces. Root scripts
delegate to each surface.

**Rationale**: Keeps the `/agent` · `/frontend` · `/contracts` boundary explicit,
gives one package manager and script surface, and lets Foundry own
Solidity-first iteration (fast compile/test + Anvil) without forcing one runtime
to own another.

**Impact**: `pnpm-workspace.yaml`, root `package.json` script set, per-surface
`package.json`/`tsconfig`/`foundry.toml`.

**Date**: 2026-05-10 · **Version**: pre-v0.1.0

### D2. LLM output is advisory only

**Context**: A risk agent that lets an LLM authorize transactions is unsafe and
non-deterministic.

**Decision**: LLM output (Groq/DeepSeek) produces only a risk score, explanation,
and suggested safe next steps. It can never authorize a transaction.

**Rationale**: Execution authority must be deterministic and auditable. Risk
analysis is informational; a transaction proceeds only via on-chain policy +
a user/agent signature.

**Impact**: `risk-score.service.ts`, `llm-risk.schema.ts`, advisory-boundary
tests; validator/approval flow holds execution authority instead.

**Date**: 2026-05-10 · **Version**: pre-v0.1.0

### D3. Deterministic policy gates before every signature

**Context**: State-changing actions (reward claims, deadman execution, safe
actions) need consistent, testable authorization.

**Decision**: Pure policy modules (`execution-policy`, `deadman-policy`,
`reward-claim-policy`) return an explicit `PolicyDecision` carrying `allowed`,
`reason`, `policyId`, `signerAddress`, `chainId`, `target`, `calldataSummary`,
`createdAt`, optional `expiresAt`. No state-changing action signs without a pass.

**Rationale**: Centralizes safety logic, makes it unit-testable, and produces
auditable decisions. Reward decisions expire after 60s to avoid stale approvals.

**Impact**: `agent/src/policies/*`, policy-check API endpoints, audit events.

**Date**: 2026-05-10 · **Version**: pre-v0.1.0

---

## Phase 1 — Active smart-account guard pivot (2026-05-14 → 2026-06-04, v0.1.0)

### D4. Pivot from passive risk scoring to an active ERC-7579 smart-account guard

**Context**: A score-only flow ("RiskGuard scores your portfolio") doesn't
prevent loss. The product name promises a *guard*, and Somnia AA + ERC-7579
modular accounts make on-chain enforcement feasible.

**Decision**: RiskGuard is an **ERC-7579 validator module** (`RiskGuardValidator`)
installed on a Thirdweb ModularAccount. It enforces a deterministic risk policy
in `validateUserOp`: safe sub-threshold native transfers pass; batches, calldata,
contract recipients, and over-threshold value are blocked with a
`PendingApprovalRequired` revert. Approval is recorded off-chain-then-on-chain
(Telegram-confirmed via `RiskGuardApprovalStore`, or a Somnia risk agent via
`requestAgentReview`/`handleRiskAssessmentResponse`), then the user resubmits.

**Rationale**: Blocking at validation time is the only way to actually *guard*
funds. ERC-4337 validation must stay bounded/deterministic, so no synchronous
LLM/Telegram/API call happens inside `validateUserOp` — the off-chain agent work
happens before resubmission and the module verifies a short-lived approval. This
realizes the "Risk = deterministic rules / Guard = on-chain enforcement / Agent =
review + explanation" model.

**Alternatives considered**:
- Keep score-only advisory flow — rejected: doesn't prevent any loss.
- Run LLM inside `validateUserOp` — rejected: violates bounded-validation rules and consensus determinism.

**Impact**: New `contracts/src/riskguard/*` (validator, hook, approval store),
`SomniaAgentInterfaces.sol`; agent `riskguard-approval.service.ts`,
`riskguard-agent-review.job.ts`, session-key signing; frontend
`riskguard-module.ts` install/config; supersedes the score-centric framing in
the original PRD/architecture. See `docs/riskguard-validation-module.md`.

**Date**: 2026-05-14 · **Version**: v0.1.0

### D5. Non-custodial living-vault inheritance

**Context**: An inheritance vault that requires depositing full balance blocks
day-to-day usage and concentrates custody risk.

**Decision**: `RiskGuardInheritanceRegistry` stores inheritance *policy* only
(beneficiaries by bps, protected assets, heartbeat/grace/timelock, state). Funds
stay in the user's smart account; distribution executes transfers **from** the
smart account, never from the registry. EOAs cannot create plans (no
`executeBatch`).

**Rationale**: Users must keep using their money. The registry is policy + state,
not a custody vault. The smart account pre-authorizes the registry/module
distribution path, so no fresh user signature is needed after expiry.

**Alternatives considered**:
- Standalone deposit vault — rejected: blocks normal usage; removed as a user-facing path.

**Impact**: `contracts/src/InheritanceRegistry.sol`, frontend inheritance
settings, `docs/somnia-agent-reactivity-context.md`.

**Date**: 2026-05-14 · **Version**: v0.1.0

### D6. Somnia Reactivity + consensus Agents for inheritance, not off-chain polling

**Context**: A dead-man's switch driven by an off-chain cron is a centralized
trust + liveness risk.

**Decision**: Inheritance distribution is scheduled via Somnia Native On-Chain
Reactivity (`Schedule` at `timelockEndsAt`, fired by the `0x0100` precompile into
`onEvent`). Heartbeat liveness and distribution approval use consensus-validated
Somnia Agents (`triggerAgentHeartbeat`/`handleHeartbeatResponse`,
`triggerDistributionAgent`/`handleDistributionResponse`). A manual
`executeInheritance` fallback remains.

**Rationale**: Same-block, decentralized, trustless handling; agent outputs are
consensus-verified chain inputs, not single-server oracle responses. Handler
entrypoints are gated to the precompile/platform caller.

**Impact**: `InheritanceRegistry.sol` reactivity + agent callbacks,
`configure-agents.mjs`, agent-budget accounting per smart account.

**Date**: 2026-05-21 · **Version**: v0.1.0

### D7. Thirdweb for account abstraction (frontend), ethers for the agent

**Context**: Smart-wallet UX and backend contract execution have different needs.

**Decision**: The frontend uses `thirdweb` for ERC-7579 ModularAccount connection,
gas sponsorship, and connect UX (`createThirdwebAccountAbstraction`, deterministic
`riskGuardAccountSalt`). The backend agent keeps `ethers` v6 for contract reads,
event polling, and signing. `@somnia-chain/reactivity`/precompile ABI is reserved
for Reactivity, not wallet UX.

**Rationale**: Matches Somnia's documented Thirdweb AA path for the dashboard while
keeping the agent's existing ethers integration; avoids mixing wallet UX into the
backend.

**Impact**: `frontend/src/lib/thirdweb-client.ts`, `riskguard-module.ts`,
`native-transfer.ts`; agent integrations stay on ethers.

**Date**: 2026-05-23 · **Version**: v0.1.0

### D8. Supabase + JSON-store dual persistence

**Context**: MVP needs durable, shareable storage for encrypted session keys and
user records, while local/dev and tests need a zero-dependency store.

**Decision**: A single `RepositoryStore<T>` contract with two implementations —
`SupabaseJsonStore` (REST; collection records in `agent_records`, dedicated
`users`/`session_keys` tables) and `JsonStore` (file-backed with a write queue).
Session keys are AES-encrypted at rest with `SESSION_KEY_ENCRYPTION_KEY`.

**Rationale**: Supabase gives durable encrypted storage and a clean REST boundary
(service role key stays server-side; browser never touches tables). The JSON store
keeps local dev and tests dependency-free. This revises the planning-era
"JSON files only" assumption.

**Impact**: `agent/src/persistence/supabase-json-store.ts`, `json-store.ts`, all
repositories, `infra/supabase/setup.sql`, `docs/local-supabase.md`.

**Date**: 2026-05-28 · **Version**: v0.1.0

### D9. Telegram polling with signed callback payloads

**Context**: Quick actions from Telegram must be reliable in a demo and safe
against replay/forgery.

**Decision**: Long-polling (`getUpdates`) for MVP; webhook deferred. Button
payloads are HMAC-SHA256-signed compact strings with a nonce and TTL, bound to a
wallet↔chat pairing; replayed/expired/forged callbacks fail closed. A
`DisabledTelegramClient` no-ops when no bot token is configured.

**Rationale**: Polling avoids public webhook infra for the Agentathon while signed
callbacks + nonces enforce authenticity and replay protection.

**Impact**: `telegram/telegram.client.ts`, `telegram/callback-signing.ts`,
`action-nonces.repository.ts`, `telegram-*` services.

**Date**: 2026-05-13 · **Version**: v0.1.0

### D10. `config/public-chains.json` is the chain-metadata source of truth

**Context**: Chain id, RPC, explorer, native currency, and deployed contract
addresses are non-secret and must stay consistent across agent, frontend, and
contract tooling.

**Decision**: All non-secret chain/contract metadata lives in
`config/public-chains.json` (default `somnia-testnet`, chainId 50312). Env keeps
only secrets and optional overrides (legacy `SOMNIA_*` fallback,
`*_CONTRACT_ADDRESS` overrides).

**Rationale**: One committed source avoids drift between surfaces; secrets stay in
env, public config stays in git.

**Impact**: `agent/src/config/public-chain.ts`, frontend `thirdweb-client.ts`,
`configure-agents.mjs`.

### D11. Remove off-chain LLM risk scoring (revision of D2)

**What changed**: D2 kept an off-chain LLM (Groq primary, DeepSeek fallback) that
produced a portfolio risk score + explanation for Telegram alerts. With the D4
pivot to an active on-chain guard, the real risk intelligence is the
consensus-validated **Somnia risk agent** (on-chain LLM Inference) invoked by
`RiskGuardValidator.requestAgentReview`. The off-chain Groq/DeepSeek path was
redundant (never surfaced in the dashboard) and added external-provider keys + a
second, weaker risk source.

**New decision**: Drop off-chain LLM risk scoring entirely. Removed
`GroqClient`/`DeepSeekClient`, `RiskScoreService`, the `RiskProvider` abstraction
(`llm-risk.schema.ts`, `risk-prompt.ts`), the `GROQ_*`/`DEEPSEEK_*` env vars, the
`POST /api/risk-snapshots/analyze` and `POST /api/telegram/test-alert` endpoints,
and the Telegram risk-score alert. Portfolio monitoring still runs (change
detection + snapshot persistence + audit), but with no LLM step. Risk snapshots
now originate only from demo scenarios (`provider: "demo" | "none"`) and the
on-chain agent review decision.

**Rationale**: One risk-intelligence source, on-chain and consensus-verified,
matches the product framing ("Agent = on-chain LLM review") and removes external
LLM dependencies and keys.

**Impact**: deletes `agent/src/integrations/llm/*` and
`agent/src/services/risk-score.service.ts`; trims `main.ts`, `env.ts`,
`logger.ts`, `portfolio-monitor.job.ts`, `telegram-alert.service.ts`,
`api/server.ts`, `risk-snapshots.repository.ts` (provider enum), and frontend
`agent-api.ts` `RiskSnapshot` type. Updates AD-2.

**Date**: 2026-06-04 · **Version**: v0.1.0

**Date**: 2026-05-21 · **Version**: v0.1.0

## Phase 2 — Single-signature setup + delivery-channel gating (2026-06-08, post-v0.1.0)

### D12. Authorize the inheritance registry via `installModule`, not `grantRoles`

**Context**: Inheritance distribution needs the registry to transfer assets from
the user's smart account. The first implementation granted the registry a Solady
admin role (`grantRoles(registry, 1)`). When bundled into a single ERC-7579
execute-batch (to save signatures), the `grantRoles` self-call ran with
`msg.sender = the account` and reverted `Unauthorized()` (`0x82b42900`), because
Solady `grantRoles` is `onlyOwner`. Verified on-chain against the live
`thirdweb.modular.v0.0.1` account.

**Decision**: Authorize the registry as an ERC-7579 **executor module** via
`installModule(2, registry)`. `installModule` is `onlyEntryPointOrSelf`, so the
self-call inside the batch succeeds; the registry is already built as an executor
module (`moduleTypeId() == 2`, `onInstall`) and distribution already prefers
`executeFromExecutor`. `isModuleInstalled` replaces the `hasAnyRole` check.

**Rationale**: This is both the fix for the batch revert and the
standards-correct authorization path for an executor that calls
`executeFromExecutor`.

**Impact**: `frontend/src/lib/inheritance-registry.ts` (both the thirdweb batch
and the ethers fallback). Enables D13.

**Date**: 2026-06-08 · **Version**: post-v0.1.0

### D13. One signature for inheritance plan creation (ERC-7579 batch)

**Context**: Creating a plan previously needed up to three separate signed txs
(authorize executor + `fundAgentBudget` + `createPlan`).

**Decision**: Bundle all three into a single signed UserOp via
`sendRiskGuardedSmartBatch` (ERC-7579 calltype `0x01`), sharing the same
sign → block → agent-review → replay path as the single-call helper.

**Date**: 2026-06-08 · **Version**: post-v0.1.0

### D14. Telegram-first gate for RiskGuard setup + inheritance creation

**Context**: A user could enable RiskGuard or create an inheritance plan with no
Telegram link — leaving risk alerts and heartbeat reminders with no delivery
channel.

**Decision**: A frontend UX guard: `handleConfigureRiskPolicy` (when enabling) and
`handleInheritancePlanSubmit` abort with a warning toast unless
`telegramSession?.connected`. Toast-only (no disabled controls); disabling and
cancelling are never blocked. Enforcement of execution authority still lives
on-chain (D4) — this is purely a setup-time UX prerequisite.

**Date**: 2026-06-08 · **Version**: post-v0.1.0
