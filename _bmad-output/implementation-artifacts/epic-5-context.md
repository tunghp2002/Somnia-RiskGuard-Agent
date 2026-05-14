# Epic 5 Context: Safe Reward Claim Automation

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 5 adds constrained automatic claiming for small staking or LP rewards. The agent should detect configured claimable rewards, evaluate deterministic value and gas policies, execute only eligible claims through the dedicated agent wallet boundary, record every outcome, notify the user when Telegram is configured, and reject unsupported autonomous actions. The purpose is to demonstrate useful on-chain autonomy without expanding into unrestricted transfers, trading, or rebalancing.

## Stories

- Story 5.1: Detect Claimable Rewards
- Story 5.2: Apply Reward Claim Value And Gas Policies
- Story 5.3: Execute Eligible Reward Claims Through Agent Wallet
- Story 5.4: Record And Notify Reward Claim Outcomes
- Story 5.5: Block Unsupported Autonomous Actions

## Requirements & Constraints

Reward claiming must be explicitly configurable. The user can enable or disable automatic reward claiming and configure minimum reward value and maximum gas cost limits. Claims are allowed only when the detected reward passes these configured rules.

Reward detection must support staking or LP rewards and include deterministic demo fixtures when live testnet reward data is unavailable. If reward provider data is unavailable or detection fails, the agent records a diagnostic event and skips execution.

Execution must be policy-gated before signing. Eligible reward claims are signed only by the environment-loaded dedicated agent wallet, never by a browser wallet or user private key. Signing, RPC, or contract failures must be recorded and must not trigger retries that bypass policy checks.

Reward outcomes must be auditable. Skipped, attempted, failed, and successful claims must record reward amount, gas condition, status, and transaction hash when available. Telegram notifications should clearly report claim outcomes when a user has Telegram configured.

Unsupported autonomous actions remain outside the MVP. Arbitrary transfers, unrestricted trading, and unbounded rebalancing must be denied before signing, and audit history must expose the denial reason and requested action type without leaking secrets.

## Technical Decisions

The backend agent owns scheduled jobs, policy gates, safe execution, Telegram reporting, and Somnia integration. Jobs call services; services call repositories, policies, and integrations; API routes call services rather than integrations directly.

Use TypeScript with zod validation, pino-compatible structured logging, JSON repositories, Vitest tests, and existing API response conventions. Runtime persistence should follow the existing repository pattern used by users, risk snapshots, audit events, and heartbeats.

Expected Epic 5 modules are `agent/src/jobs/reward-claim.job.ts`, `agent/src/services/reward-claim.service.ts`, `agent/src/policies/reward-claim-policy.ts`, `agent/src/persistence/reward-claims.repository.ts`, and Somnia integration through `agent/src/integrations/somnia/somnia-agent-kit.client.ts` or the configured EVM client boundary.

`node-cron` is the scheduled polling mechanism for reward-claim jobs. `ethers` is the primary EVM integration library, with `viem` acceptable for typed reads or local simulation ergonomics. Policies must pass before any state-changing Somnia Agent Kit or EVM call.

## Cross-Story Dependencies

Reward detection feeds policy evaluation. Policy approval gates execution. Execution and policy skips both feed outcome persistence and Telegram reporting. Unsupported-action denial should share the same deterministic policy and audit posture as reward claim execution so no autonomous action can bypass the MVP boundaries.
