---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/prd-validation-report.md
  - _bmad-output/planning-artifacts/architecture.md
workflowType: 'epics-and-stories'
status: 'complete'
completedAt: '2026-05-11'
---

# Somnia RiskGuard Agent - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Somnia RiskGuard Agent, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Users can connect a browser wallet to identify the monitored Somnia wallet.

FR2: Users can view detected wallet address, network status, and configuration readiness.

FR3: Users can configure risk alert thresholds for portfolio monitoring.

FR4: Users can configure Telegram notification settings.

FR5: Users can configure heartbeat interval, grace period, and beneficiary wallet.

FR6: Users can enable or disable automatic small reward claiming.

FR7: Users can configure minimum reward value and maximum gas cost limits for reward claims.

FR8: The agent can monitor configured wallet portfolio state on Somnia.

FR9: The agent can detect relevant portfolio, reward, and risk signal changes.

FR10: The agent can generate an AI Risk Score for a monitored wallet state.

FR11: The agent can explain the main factors behind a Risk Score in user-readable language.

FR12: The agent can retry risk analysis through a fallback AI provider when the primary provider fails.

FR13: Users can view current portfolio status, Risk Score, and recent risk explanations.

FR14: The agent can send Telegram alerts when configured risk conditions occur.

FR15: The agent can include clear explanation text and quick action buttons in Telegram alerts.

FR16: Users can acknowledge alerts through Telegram.

FR17: Users can request refreshed risk analysis through Telegram.

FR18: Users can approve supported safe actions through authenticated Telegram quick actions.

FR19: The system can reject unauthorized, expired, or replayed Telegram actions.

FR20: Users can create and update heartbeat settings for a monitored wallet.

FR21: Users can perform heartbeat check-ins.

FR22: The agent can detect missed heartbeat deadlines.

FR23: The agent can send heartbeat reminder notifications before Dead Man's Switch activation.

FR24: The system can expose heartbeat status, expiry status, and timelock status.

FR25: The Dead Man's Switch can enter an expired state after missed heartbeat rules are met.

FR26: The Dead Man's Switch can enforce a timelock before beneficiary execution.

FR27: The beneficiary can view safe claim or execution status when the Dead Man's Switch is active.

FR28: The system can prevent Dead Man's Switch execution before configured conditions are met.

FR29: The agent can identify claimable small staking or LP rewards.

FR30: The agent can skip reward claims that do not satisfy configured value and gas rules.

FR31: The agent can execute eligible small reward claims through the dedicated agent wallet.

FR32: The system can record each skipped, attempted, failed, or successful on-chain action.

FR33: The system can prevent unsupported actions such as arbitrary transfers, unrestricted trading, and unbounded rebalancing.

FR34: The system can require deterministic policy approval before any transaction is signed.

FR35: Users can view setup state, portfolio overview, Risk Score, heartbeat status, and recent actions in a dashboard overview.

FR36: Users can distinguish simulated demo behavior from Somnia Testnet-backed behavior.

FR37: The operator can run deterministic demo scenarios for risk alerts, reward claims, heartbeat expiry, and Dead Man's Switch timelock.

FR38: The operator can view subsystem health for monitoring, AI providers, Telegram, RPC, signer, and contracts.

FR39: The operator can inspect secret-safe logs for alerts, risk analysis, policy decisions, and transaction outcomes.

FR40: The system can validate required runtime configuration before agent startup.

FR41: The system can fail closed when required providers, wallets, contracts, or policy checks are invalid.

FR42: The system can keep frontend wallet connection separate from backend agent wallet execution.

FR43: The system can expose audit-friendly action history without revealing secrets.

FR44: The system can frame AI Risk Score output as informational analysis rather than financial advice.

### NonFunctional Requirements

NFR1: Risk Score generation should complete within 10 seconds under normal demo conditions.

NFR2: Telegram alerts should be sent within 15 seconds after a simulated or detected risk event.

NFR3: Dashboard setup flow should be completable within 3 minutes during demo.

NFR4: Portfolio status and heartbeat status should refresh quickly enough for demo users to understand current system state without manual log inspection.

NFR5: Secrets, private keys, bot tokens, RPC keys, and LLM API keys must only be loaded from environment variables.

NFR6: The frontend must never request, store, or transmit user private keys.

NFR7: The backend agent wallet must be separated from the user's browser wallet.

NFR8: LLM output must never directly authorize transactions.

NFR9: Every transaction must pass deterministic policy checks before signing.

NFR10: Telegram quick actions must be authenticated and protected against replay or unauthorized use.

NFR11: Logs must not expose secrets, private keys, full credentials, or sensitive payloads.

NFR12: Production, mainnet, or high-value usage requires external security audit before launch.

NFR13: The agent must fail closed when required configuration, RPC provider, signer, contract address, Telegram token, or LLM provider is invalid.

NFR14: Groq failures must fall back to DeepSeek where possible.

NFR15: Failed Telegram, RPC, LLM, and transaction flows must produce actionable diagnostic logs.

NFR16: Dead Man's Switch activation must include reminders, grace period handling, and timelock visibility to reduce false activation risk.

NFR17: Reward claim automation must skip execution when thresholds or policy checks fail.

NFR18: Somnia RPC, LLM providers, Telegram, and smart contract integrations must expose health or failure state to the operator.

NFR19: Public chain metadata such as chain ID, public RPC URL, explorer URL, native currency metadata, and public contract addresses must be loaded from `config/public-chains.json` or an equivalent committed public config file; private keys, bot tokens, LLM keys, and provider credentials remain environment-driven.

NFR20: Demo simulation mode must clearly distinguish simulated behavior from Somnia Testnet-backed behavior.

NFR21: The agent and dashboard must read contract state consistently for heartbeat, expiry, timelock, beneficiary, and execution status.

NFR22: Dashboard flows must use clear labels and status text for setup, heartbeat, risk, and action history.

NFR23: Beneficiary-facing messages must avoid technical jargon and clearly explain current status, waiting periods, and available actions.

NFR24: Critical alerts must not rely on color alone to communicate severity.

NFR25: Backend, frontend, and contracts must remain separated under `/agent`, `/frontend`, and `/contracts`.

NFR26: Core policy checks must be testable independently from LLM output and Telegram delivery.

NFR27: Contract tests must cover heartbeat renewal, expiry, timelock behavior, beneficiary configuration, safe execution authorization, unauthorized access rejection, and false-trigger prevention.

NFR28: The codebase must use typed configuration and validation to prevent invalid runtime states.

### Additional Requirements

- Use a root-level pnpm workspace as the single JavaScript/TypeScript package manager across `/agent`, `/frontend`, and `/contracts`.
- Include `agent`, `frontend`, and `contracts` in `pnpm-workspace.yaml`.
- Use Foundry for `/contracts` Solidity build, test, formatting, scripts, and local simulation workflows.
- Use Next.js 15 App Router, Tailwind, and shadcn/ui for the dashboard.
- Use Node.js + TypeScript for the backend agent runtime.
- Use Somnia Agent Kit as the core SDK boundary for agent registration, tool calling, and Somnia-specific on-chain interactions.
- Use ethers.js v6 as the primary EVM integration library, with viem available for typed reads, ABI ergonomics, and Anvil/local simulation utilities.
- Use Groq as the primary LLM provider and DeepSeek as fallback.
- Use zod for runtime configuration, request validation, Telegram callback payloads, JSON persistence shape validation, and policy decision schemas.
- Use pino for structured, secret-safe logs.
- Use node-cron for scheduled monitoring, heartbeat checks, and reward-claim polling.
- Use dotenv for local secret loading.
- Use `config/public-chains.json` for non-secret Somnia chain metadata shared by agent and frontend.
- Use lightweight JSON file persistence plus in-memory cache for MVP state.
- Keep JSON data under `/agent/src/persistence/data` and access it only through repository helpers.
- Use append-friendly audit event records for risk analysis, alerts, skipped actions, policy decisions, and transaction outcomes.
- Expose a local/demo REST JSON API from the agent for dashboard setup and state reads.
- Use response format `{ data, meta }` for success and `{ error: { code, message, details } }` for failures.
- Serialize dates as ISO 8601 strings and on-chain BigInt values as decimal strings.
- Checksum-normalize wallet addresses before persistence.
- Use signed-message proof for protected dashboard configuration actions.
- Use signed Telegram callback payloads with nonce, TTL, replay protection, and wallet/Telegram binding checks.
- Wrap every Somnia Agent Kit state-changing tool call in deterministic local policy checks.
- Keep LLM output advisory only; it must never directly authorize a transaction.
- Keep the frontend as setup/overview only; it must never store, request, or transmit private keys.
- Use a dedicated env-loaded backend agent wallet for constrained safe actions.
- Use Telegram polling for local/demo MVP reliability; defer webhook deployment.
- Maintain explicit local/demo simulation mode separate from Somnia Testnet behavior.
- Contract scope must remain minimal: heartbeat, beneficiary configuration, expiry/timelock state, safe execution functions, access control, and readable state.
- Contract implementation should prioritize simple, readable, secure code over extreme gas optimization.
- Root scripts should orchestrate `dev`, `build`, `test`, `lint`, and contract formatting across workspaces.
- Agent entrypoint should be `agent/src/main.ts`; `agent/src/index.ts` should export reusable modules for tests and scripts.
- Tests should cover policy gates, Telegram replay/expiry checks, LLM fallback, JSON persistence validation, and contract safety behavior.
- CI should run agent tests, frontend build/lint, and Foundry tests separately.
- Production/mainnet or high-value usage requires external audit beyond MVP internal review and automated tests.
- PRD validation follow-up: tighten measurable NFR verification methods before implementation readiness review.
- PRD validation follow-up: add fintech/Web3 compliance and abuse-case coverage for data handling, Telegram compromise, beneficiary spoofing, malicious configuration, replay attacks, and provider/RPC manipulation.

### UX Design Requirements

No dedicated UX Design Specification was found in `_bmad-output/planning-artifacts`. UX-related requirements extracted from the PRD are represented in FR13, FR15, FR24, FR27, FR35, FR36, NFR22, NFR23, and NFR24.

### FR Coverage Map

FR1: Epic 1 - Browser wallet connection.

FR2: Epic 1 - Wallet, network, and configuration readiness.

FR3: Epic 2 - Risk threshold configuration.

FR4: Epic 3 - Telegram notification settings.

FR5: Epic 4 - Heartbeat and beneficiary configuration.

FR6: Epic 5 - Enable or disable reward claiming.

FR7: Epic 5 - Reward value and gas limits.

FR8: Epic 2 - Portfolio monitoring.

FR9: Epic 2 - Portfolio, reward, and risk signal detection.

FR10: Epic 2 - AI Risk Score generation.

FR11: Epic 2 - User-readable risk explanation.

FR12: Epic 2 - DeepSeek fallback when Groq fails.

FR13: Epic 2 - Portfolio and risk visibility.

FR14: Epic 3 - Telegram risk alerts.

FR15: Epic 3 - Telegram explanation text and quick action buttons.

FR16: Epic 3 - Alert acknowledgment.

FR17: Epic 3 - Refreshed analysis from Telegram.

FR18: Epic 3 - Supported safe action approval.

FR19: Epic 3 - Unauthorized, expired, or replayed action rejection.

FR20: Epic 4 - Heartbeat settings creation and update.

FR21: Epic 4 - Heartbeat check-ins.

FR22: Epic 4 - Missed heartbeat deadline detection.

FR23: Epic 4 - Heartbeat reminder notifications.

FR24: Epic 4 - Heartbeat, expiry, and timelock status.

FR25: Epic 4 - Expired Dead Man's Switch state.

FR26: Epic 4 - Timelock enforcement.

FR27: Epic 4 - Beneficiary safe claim or execution status.

FR28: Epic 4 - Prevention of early Dead Man's Switch execution.

FR29: Epic 5 - Claimable reward identification.

FR30: Epic 5 - Unsafe or uneconomic reward claim skipping.

FR31: Epic 5 - Eligible reward claim execution.

FR32: Epic 5 - On-chain action outcome recording.

FR33: Epic 5 - Unsupported action prevention.

FR34: Epic 5 - Deterministic policy approval before signing.

FR35: Epic 6 - Dashboard overview.

FR36: Epic 6 - Demo and Somnia Testnet distinction.

FR37: Epic 6 - Deterministic demo scenarios.

FR38: Epic 6 - Subsystem health visibility.

FR39: Epic 6 - Secret-safe logs.

FR40: Epic 1 - Runtime configuration validation.

FR41: Epic 1 - Fail-closed startup and invalid-state handling.

FR42: Epic 1 - Frontend wallet and backend agent wallet separation.

FR43: Epic 1 - Audit-friendly action history.

FR44: Epic 2 - Informational, non-advisory AI output.

## Epic List

### Epic 1: Secure Agent Foundation & User Setup

Users and the operator can run the project safely with validated config, separated wallets, workspace scaffolding, and basic monitored-wallet setup.

**User Outcome:** The system can start safely, distinguish frontend user wallet from backend agent wallet, validate env config, and store user setup state without secrets.

**FRs covered:** FR1, FR2, FR40, FR41, FR42, FR43

**Epic size:** Large

**Natural dependency:** Must come first.

### Epic 2: Portfolio Monitoring & AI Risk Engine

Users can monitor a Somnia wallet and receive understandable AI Risk Scores with Groq primary and DeepSeek fallback.

**User Outcome:** Alex can see portfolio state, risk score, and readable explanations without watching dashboards constantly.

**FRs covered:** FR3, FR8, FR9, FR10, FR11, FR12, FR13, FR44

**Epic size:** Large

**Natural dependency:** Depends on Epic 1.

### Epic 3: Telegram Alerts & Authenticated Quick Actions

Users can receive risk alerts in Telegram and respond through authenticated, replay-safe quick actions.

**User Outcome:** Alex can acknowledge alerts, refresh analysis, and approve supported safe actions without opening the dashboard.

**FRs covered:** FR4, FR14, FR15, FR16, FR17, FR18, FR19

**Epic size:** Medium

**Natural dependency:** Depends on Epic 1; works best after Epic 2.

### Epic 4: Heartbeat Timer & Dead Man's Switch Protection

Users can configure heartbeat rules and beneficiary protection, while the system prevents premature or unsafe execution.

**User Outcome:** Alex can configure emergency protection, and Sarah can see clear beneficiary/timelock status if Alex misses check-ins.

**FRs covered:** FR5, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27, FR28

**Epic size:** Large

**Natural dependency:** Depends on Epic 1.

### Epic 5: Safe Reward Claim Automation

Users can enable constrained auto-claiming for small staking/LP rewards with deterministic policy checks and audit records.

**User Outcome:** The agent proves useful on-chain autonomy by claiming small safe rewards while rejecting risky or unsupported actions.

**FRs covered:** FR6, FR7, FR29, FR30, FR31, FR32, FR33, FR34

**Epic size:** Medium

**Natural dependency:** Depends on Epic 1; integrates with Epic 3 for notifications.

### Epic 6: Dashboard, Demo Mode & Operator Visibility

Users and judges can view setup state, portfolio/risk status, heartbeat state, recent actions, health checks, and deterministic demo scenarios.

**User Outcome:** The demo can show the full agentic loop clearly: setup -> monitoring -> AI reasoning -> Telegram action -> reward claim -> Dead Man's Switch simulation.

**FRs covered:** FR35, FR36, FR37, FR38, FR39

**Epic size:** Medium

**Natural dependency:** Builds on all prior epics but can start with stubbed agent APIs.

### Epic 7: Runtime Integration & MVP Acceptance Hardening

The team can trust that the marked-complete MVP works through the normal `pnpm dev` path, with scheduled agent behavior, browser-visible state, honest demo/testnet labeling, and repeatable smoke verification.

**User Outcome:** The dashboard and agent behave as a coherent product instead of separate implemented slices. Operators can run a deterministic demo, inspect live state, and know exactly which flows are simulation-backed versus Somnia Testnet-backed.

**FRs covered:** FR1, FR2, FR3, FR4, FR13, FR14, FR23, FR31, FR35, FR36, FR38, FR39, FR41

**Epic size:** Medium

**Natural dependency:** Must complete after Epics 1-6 and before retrospective/demo finalization.

## Epic 1: Secure Agent Foundation & User Setup

Users and the operator can run the project safely with validated config, separated wallets, workspace scaffolding, and basic monitored-wallet setup.

### Story 1.1: Set Up Initial Project From Starter Template

As a developer/operator,
I want the root workspace, package scripts, and baseline configs created,
So that all implementation work starts from one consistent project structure.

**Effort:** Medium

**Requirements:** FR40, FR41

**Acceptance Criteria:**

**Given** the repository root is empty or partially scaffolded
**When** the workspace foundation is implemented
**Then** root `package.json`, `pnpm-workspace.yaml`, and `tsconfig.json` exist
**And** `agent`, `frontend`, and `contracts` are registered as pnpm workspace packages.

**Given** a developer runs root scripts
**When** `pnpm dev`, `pnpm build`, `pnpm test`, or targeted workspace scripts are used
**Then** commands delegate to the correct workspace scripts without mixing toolchains.

### Story 1.2: Configure Secure Agent Runtime Startup

As an operator,
I want the agent to validate environment configuration before startup,
So that missing secrets, wrong chain settings, or unsafe runtime states fail closed.

**Effort:** Medium

**Requirements:** FR40, FR41, FR43

**Acceptance Criteria:**

**Given** required environment variables are missing or malformed
**When** the agent starts
**Then** zod validation fails with a safe diagnostic message
**And** the agent does not start background jobs or expose execution endpoints.

**Given** valid environment variables are present
**When** the agent starts
**Then** typed config is available to services
**And** no secret values are printed to logs.

### Story 1.3: Add Structured Logging And Audit Event Foundation

As an operator,
I want structured secret-safe logs and append-friendly audit records,
So that agent behavior can be inspected without leaking credentials.

**Effort:** Medium

**Requirements:** FR43

**Acceptance Criteria:**

**Given** the agent emits operational logs
**When** logs include provider, wallet, policy, or transaction context
**Then** pino outputs structured fields
**And** configured secret fields are redacted.

**Given** a risk analysis, alert, policy decision, or transaction attempt occurs
**When** an audit event is recorded
**Then** it is written through the audit repository
**And** it includes timestamp, event type, status, and safe metadata.

### Story 1.4: Implement JSON Persistence Repositories

As a developer,
I want typed JSON repositories under agent persistence,
So that MVP state is durable enough for demos without introducing a database.

**Effort:** Medium

**Requirements:** FR43

**Acceptance Criteria:**

**Given** the agent needs to persist users, risk snapshots, nonces, reward claims, or audit events
**When** a repository writes data
**Then** JSON is stored under `agent/src/persistence/data`
**And** writes go through schema-validated repository helpers.

**Given** persisted JSON is malformed
**When** the repository loads state
**Then** validation fails safely
**And** the agent reports an actionable startup or repository error.

### Story 1.5: Implement Wallet Separation And Setup API

As a user,
I want to register my monitored wallet while the agent uses its own executor wallet,
So that portfolio monitoring and safe actions do not require exposing my private keys.

**Effort:** Medium

**Requirements:** FR1, FR2, FR42

**Acceptance Criteria:**

**Given** a browser wallet address is submitted to the agent API
**When** the setup request is valid
**Then** the monitored wallet address is checksum-normalized and persisted
**And** no private key is accepted or stored.

**Given** the backend agent wallet is configured through environment variables
**When** setup readiness is requested
**Then** the API reports user wallet and agent wallet readiness separately
**And** secret values are never returned.

### Story 1.6: Create Somnia Agent Kit Integration Boundary

As a developer/operator,
I want Somnia Agent Kit isolated behind a local integration client,
So that agent registration, tool calling, and on-chain interactions are policy-gated consistently.

**Effort:** Large

**Requirements:** FR41, FR43

**Acceptance Criteria:**

**Given** the agent needs to call a Somnia tool or perform a chain interaction
**When** the service invokes the Somnia integration
**Then** calls flow through `somnia-agent-kit.client.ts`
**And** state-changing calls require a policy decision object.

**Given** Somnia Agent Kit or RPC setup fails
**When** health is checked
**Then** the failure is exposed as subsystem health
**And** execution remains disabled.

## Epic 2: Portfolio Monitoring & AI Risk Engine

Users can monitor a Somnia wallet and receive understandable AI Risk Scores with Groq primary and DeepSeek fallback.

### Story 2.1: Monitor Portfolio State For Configured Wallets

As a user,
I want the agent to read my Somnia portfolio state,
So that risk analysis is based on current wallet information.

**Effort:** Medium

**Requirements:** FR8, FR13

**Acceptance Criteria:**

**Given** a monitored wallet is configured
**When** the portfolio monitor job runs
**Then** the agent reads wallet state from Somnia Testnet or explicit demo fixtures
**And** records the latest portfolio snapshot.

**Given** chain configuration is invalid
**When** monitoring runs
**Then** the monitor fails closed
**And** a subsystem health error is recorded.

### Story 2.2: Detect Portfolio And Risk Signal Changes

As a user,
I want the agent to detect meaningful portfolio or reward changes,
So that I am alerted only when the state warrants analysis.

**Effort:** Medium

**Requirements:** FR3, FR9

**Acceptance Criteria:**

**Given** a previous portfolio snapshot exists
**When** a new snapshot is collected
**Then** the agent identifies balance, reward, and configured risk-signal changes
**And** stores whether a risk analysis should be triggered.

**Given** no meaningful change is detected
**When** monitoring completes
**Then** the agent skips risk analysis
**And** records a safe audit event if configured.

### Story 2.3: Generate AI Risk Score With Groq And DeepSeek Fallback

As a user,
I want an AI-generated Risk Score with provider fallback,
So that analysis remains available when the primary provider fails.

**Effort:** Medium

**Requirements:** FR10, FR11, FR12

**Acceptance Criteria:**

**Given** portfolio context is ready for analysis
**When** Groq returns a valid response
**Then** the agent produces a Risk Score from 0 to 100
**And** stores the provider, score, explanation, and timestamp.

**Given** Groq fails or times out
**When** fallback is available
**Then** the agent retries with DeepSeek
**And** records the fallback decision in logs and audit history.

### Story 2.4: Enforce Advisory Risk Explanation Boundaries

As a user,
I want Risk Score output to be clear and non-advisory,
So that the agent explains risk without pretending to be a financial advisor.

**Effort:** Small

**Requirements:** FR11, FR33, FR44

**Acceptance Criteria:**

**Given** a risk analysis is generated
**When** the explanation is returned
**Then** it includes user-readable reasons for the score
**And** frames output as informational analysis rather than investment advice.

**Given** an LLM response proposes unsupported trading or arbitrary transfers
**When** the response is processed
**Then** unsafe recommendations are excluded from executable actions
**And** only safe suggested next steps are displayed.

### Story 2.5: Persist Risk Snapshots And Threshold Results

As a user,
I want current and recent risk results persisted,
So that the dashboard and Telegram flows can display consistent risk state.

**Effort:** Small

**Requirements:** FR3, FR13

**Acceptance Criteria:**

**Given** a Risk Score is generated
**When** it is persisted
**Then** the risk snapshot includes wallet address, score, explanation, provider, threshold result, and timestamp.

**Given** the score crosses a configured threshold
**When** threshold evaluation completes
**Then** the result can be consumed by Telegram alerts and dashboard overview.

## Epic 3: Telegram Alerts & Authenticated Quick Actions

Users can receive risk alerts in Telegram and respond through authenticated, replay-safe quick actions.

### Story 3.1: Configure And Link Telegram Notifications

As a user,
I want to link Telegram notification settings,
So that the agent can send alerts to the correct chat.

**Effort:** Medium

**Requirements:** FR4

**Acceptance Criteria:**

**Given** a Telegram chat is linked to a monitored wallet
**When** settings are saved
**Then** the agent persists the chat binding
**And** validates required Telegram bot configuration.

**Given** Telegram config is missing or invalid
**When** notification setup or bot startup runs
**Then** Telegram health reports failure
**And** alerts are not attempted.

### Story 3.2: Send Risk Alerts With Explanation And Buttons

As a user,
I want Telegram risk alerts with clear explanations and quick actions,
So that I can respond without opening the dashboard.

**Effort:** Medium

**Requirements:** FR14, FR15

**Acceptance Criteria:**

**Given** a risk threshold is crossed
**When** the alert service sends a Telegram message
**Then** the message includes Risk Score, short explanation, severity, and quick action buttons.

**Given** a Telegram send fails
**When** the failure is caught
**Then** the agent records a diagnostic log and audit event
**And** does not retry unsafe actions automatically.

### Story 3.3: Sign And Validate Telegram Callback Payloads

As a user,
I want Telegram quick actions protected from replay or spoofing,
So that only valid actions can affect my agent configuration or execution flow.

**Effort:** Medium

**Requirements:** FR18, FR19

**Acceptance Criteria:**

**Given** a quick action button is generated
**When** the callback payload is created
**Then** it includes action type, user ID, nonce, expiry, and signature.

**Given** a callback is expired, replayed, malformed, or unsigned
**When** it is received
**Then** the action is rejected
**And** the rejection is recorded without executing side effects.

### Story 3.4: Support Acknowledge And Refresh Risk Actions

As a user,
I want to acknowledge alerts and request refreshed analysis from Telegram,
So that I can manage risk notifications quickly.

**Effort:** Medium

**Requirements:** FR16, FR17

**Acceptance Criteria:**

**Given** a valid acknowledge callback is received
**When** the agent processes it
**Then** the alert is marked acknowledged
**And** the user receives confirmation.

**Given** a valid refresh-analysis callback is received
**When** the agent processes it
**Then** a new risk analysis is requested
**And** the refreshed result is sent back to Telegram.

### Story 3.5: Route Safe Action Approvals Through Policy Gates

As a user,
I want Telegram approvals to pass through deterministic policy gates,
So that quick actions cannot bypass execution safety.

**Effort:** Medium

**Requirements:** FR18, FR19, FR33, FR34

**Acceptance Criteria:**

**Given** a Telegram callback approves a supported safe action
**When** the agent processes the approval
**Then** the action is routed to the relevant policy gate before execution
**And** policy denial prevents signing.

**Given** the requested action is unsupported
**When** the callback is processed
**Then** the agent rejects the action
**And** explains that unsupported actions are outside MVP scope.

## Epic 4: Heartbeat Timer & Dead Man's Switch Protection

Users can configure heartbeat rules and beneficiary protection, while the system prevents premature or unsafe execution.

### Story 4.1: Implement Foundry Dead Man's Switch Contract Baseline

As a user,
I want an on-chain Dead Man's Switch contract with heartbeat and beneficiary state,
So that emergency protection is enforced by contract rules.

**Effort:** Large

**Requirements:** FR24, FR25, FR26, FR28

**Acceptance Criteria:**

**Given** the contract is built with Foundry
**When** `forge build` and `forge test` run
**Then** the Dead Man's Switch contract compiles
**And** baseline tests cover ownership, beneficiary configuration, and heartbeat renewal.

**Given** an unauthorized caller attempts restricted actions
**When** contract tests execute
**Then** unauthorized access is rejected.

### Story 4.2: Configure Heartbeat Settings And Check-Ins

As a user,
I want to configure heartbeat settings and perform check-ins,
So that I can prove I am reachable before expiry.

**Effort:** Medium

**Requirements:** FR5, FR20, FR21, FR24

**Acceptance Criteria:**

**Given** a monitored wallet is configured
**When** heartbeat interval, grace period, and beneficiary wallet are submitted
**Then** the agent validates and persists the settings
**And** exposes current heartbeat status.

**Given** the user performs a heartbeat check-in
**When** the check-in succeeds
**Then** the next deadline is updated
**And** an audit event is recorded.

### Story 4.3: Send Heartbeat Reminders Before Expiry

As a user,
I want reminders before Dead Man's Switch activation,
So that missed check-ins do not immediately cause emergency flow activation.

**Effort:** Medium

**Requirements:** FR22, FR23

**Acceptance Criteria:**

**Given** a heartbeat deadline is approaching
**When** the heartbeat job runs
**Then** reminder notifications are sent through configured channels
**And** reminder events are recorded.

**Given** reminders have already been sent for a period
**When** the job runs again
**Then** duplicate reminders are limited by configured reminder rules.

### Story 4.4: Enforce Expiry And Timelock Contract Behavior

As a beneficiary,
I want expired heartbeat state to enter a visible timelock,
So that emergency execution cannot happen prematurely.

**Effort:** Large

**Requirements:** FR24, FR25, FR26, FR28

**Acceptance Criteria:**

**Given** heartbeat expiry conditions are met
**When** expiry is evaluated
**Then** the contract can enter expired/timelock state
**And** state is readable by the agent and dashboard.

**Given** timelock is still pending
**When** execution is attempted
**Then** execution is rejected
**And** tests cover false-trigger prevention.

### Story 4.5: Expose Beneficiary-Safe Status

As a beneficiary,
I want simple status messages for expiry, timelock, and claim readiness,
So that I understand what is happening without technical expertise.

**Effort:** Medium

**Requirements:** FR24, FR27

**Acceptance Criteria:**

**Given** a Dead Man's Switch is active or pending
**When** beneficiary status is requested
**Then** the system returns clear status, beneficiary wallet, timelock timing, and available next step.

**Given** no beneficiary action is available yet
**When** Sarah views status
**Then** the system explains when to return
**And** prevents ambiguous or unsafe action choices.

### Story 4.6: Prevent Premature Dead Man's Switch Execution

As a user,
I want emergency execution blocked until every configured condition is met,
So that false activation risk is minimized.

**Effort:** Medium

**Requirements:** FR28, FR32, FR34

**Acceptance Criteria:**

**Given** execution is requested before expiry, before timelock completion, or by an unauthorized caller
**When** policy and contract checks run
**Then** execution is rejected
**And** the reason is recorded in audit history.

**Given** all configured conditions are met
**When** execution status is checked
**Then** the system reports that the beneficiary path is available
**And** does not execute without the required supported action flow.

## Epic 5: Safe Reward Claim Automation

Users can enable constrained auto-claiming for small staking/LP rewards with deterministic policy checks and audit records.

### Story 5.1: Detect Claimable Rewards

As a user,
I want the agent to identify small claimable rewards,
So that safe routine claims can be automated.

**Effort:** Medium

**Requirements:** FR29

**Acceptance Criteria:**

**Given** reward monitoring is enabled
**When** the reward claim job runs
**Then** the agent detects configured claimable staking or LP rewards
**And** supports explicit demo fixtures when testnet rewards are unavailable.

**Given** reward provider data is unavailable
**When** detection fails
**Then** the agent records a diagnostic event
**And** skips execution.

### Story 5.2: Apply Reward Claim Value And Gas Policies

As a user,
I want reward claims limited by value and gas thresholds,
So that the agent does not execute uneconomic or risky transactions.

**Effort:** Medium

**Requirements:** FR6, FR7, FR30, FR34

**Acceptance Criteria:**

**Given** claimable rewards are detected
**When** reward policy evaluates them
**Then** the claim is allowed only if minimum reward value and maximum gas cost pass.

**Given** thresholds fail or auto-claim is disabled
**When** policy evaluation completes
**Then** the claim is skipped
**And** the skip reason is recorded.

### Story 5.3: Execute Eligible Reward Claims Through Agent Wallet

As a user,
I want eligible claims executed by the dedicated agent wallet,
So that routine rewards can be claimed without exposing my browser wallet private key.

**Effort:** Large

**Requirements:** FR31, FR34, FR42

**Acceptance Criteria:**

**Given** reward policy allows a claim
**When** execution is requested
**Then** the agent signs through the env-loaded agent wallet
**And** the action flows through Somnia Agent Kit or the configured EVM client boundary.

**Given** signing, RPC, or contract execution fails
**When** the transaction attempt completes
**Then** the failure is recorded
**And** no retry bypasses policy checks.

### Story 5.4: Record And Notify Reward Claim Outcomes

As a user,
I want reward claim outcomes recorded and reported,
So that I understand what the agent did or skipped.

**Effort:** Small

**Requirements:** FR32

**Acceptance Criteria:**

**Given** a reward claim is skipped, attempted, failed, or successful
**When** the outcome is known
**Then** the agent records reward amount, gas condition, status, and tx hash when available.

**Given** Telegram is configured
**When** a claim outcome is recorded
**Then** the user receives a clear notification.

### Story 5.5: Block Unsupported Autonomous Actions

As a user,
I want the agent to reject unsupported trading or transfer actions,
So that MVP autonomy stays inside safe boundaries.

**Effort:** Medium

**Requirements:** FR33, FR34

**Acceptance Criteria:**

**Given** a request attempts arbitrary transfer, unrestricted trading, or unbounded rebalancing
**When** execution policy evaluates it
**Then** the request is denied
**And** no transaction is signed.

**Given** a denied unsupported action occurs
**When** audit history is inspected
**Then** the denial reason and requested action type are visible without secrets.

## Epic 6: Dashboard, Demo Mode & Operator Visibility

Users and judges can view setup state, portfolio/risk status, heartbeat state, recent actions, health checks, and deterministic demo scenarios.

### Story 6.1: Build App Shell, Navigation, Auth, And Wallet Connection

As a user,
I want a dashboard shell with familiar sign in/out, browser wallet connection, and clear navigation,
So that I can manage RiskGuard without everything being crammed into one screen.

**Effort:** Medium

**Requirements:** FR1, FR2, FR35, FR36, FR42

**Acceptance Criteria:**

**Given** the frontend starts
**When** the user opens the dashboard
**Then** the page renders an app shell with desktop left sidebar navigation, mobile bottom navigation, wallet/auth connection state, setup summary, and demo/testnet mode visibility.

**Given** the user signs out or disconnects
**When** the action completes
**Then** local wallet/session state is cleared
**And** the UI returns to a clear disconnected state without stale private or account data.

**Given** a browser wallet is connected
**When** the dashboard reads wallet state
**Then** it displays wallet address and network status
**And** never requests or stores a private key.

### Story 6.2: Add Configuration Forms For MVP Settings

As a user,
I want focused setup screens for risk, Telegram, heartbeat, beneficiary, and reward settings,
So that I can configure the agent without editing JSON manually.

**Effort:** Large

**Requirements:** FR3, FR4, FR5, FR6, FR7, FR20, FR35

**Acceptance Criteria:**

**Given** the user enters setup values
**When** the form is submitted
**Then** the dashboard calls the agent API
**And** displays validation errors returned by the backend.

**Given** settings are saved
**When** the dashboard refreshes
**Then** current configuration readiness is displayed.

**Given** the user configures Telegram
**When** they choose Connect Telegram
**Then** the dashboard starts a bot deep-link, one-time code, QR/link fallback, or equivalent callback flow
**And** the user is not asked to manually type a Telegram chat id.

### Story 6.3: Display Portfolio, Risk, Heartbeat, And Recent Actions

As a user,
I want a dashboard overview of current agent state,
So that I can understand portfolio risk and protection status at a glance.

**Effort:** Medium

**Requirements:** FR13, FR24, FR32, FR35

**Acceptance Criteria:**

**Given** agent state is available
**When** the dashboard loads
**Then** the Overview route shows a concise status summary
**And** portfolio/risk, heartbeat, rewards, and recent actions are available in focused sections instead of a single overloaded page.

**Given** data is loading or unavailable
**When** the dashboard renders
**Then** it shows clear loading, empty, or error states without relying on color alone.

### Story 6.4: Add Deterministic Demo Scenario Controls

As a demo operator,
I want controlled demo scenarios,
So that judges can see monitoring, risk analysis, reward claims, and Dead Man's Switch flow reliably.

**Effort:** Medium

**Requirements:** FR36, FR37

**Acceptance Criteria:**

**Given** demo mode is enabled
**When** the operator triggers a demo scenario
**Then** the agent runs the selected simulated flow
**And** the dashboard clearly labels results as demo mode.

**Given** Somnia Testnet mode is active
**When** demo controls are unavailable or disabled
**Then** the dashboard prevents silent simulation/testnet mixing.

### Story 6.5: Show Operator Health And Secret-Safe Logs

As an operator,
I want subsystem health and recent secret-safe logs,
So that I can troubleshoot demo or integration failures quickly.

**Effort:** Medium

**Requirements:** FR38, FR39, FR43

**Acceptance Criteria:**

**Given** health data is available
**When** the operator opens the status view
**Then** monitoring, Groq, DeepSeek, Telegram, RPC, signer, contracts, and persistence health are shown.

**Given** recent audit or diagnostic events exist
**When** logs are displayed
**Then** they exclude secrets and sensitive payloads
**And** include enough context to identify the failing subsystem.

## Epic 7: Runtime Integration & MVP Acceptance Hardening

The team can trust that the marked-complete MVP works through the normal `pnpm dev` path, with scheduled agent behavior, browser-visible state, honest demo/testnet labeling, and repeatable smoke verification.

### Story 7.1: Run Agent Jobs In Normal Runtime

As an operator,
I want `pnpm dev` to start scheduled monitoring, heartbeat, and reward jobs,
So that the agent performs work without manual test harnesses.

**Effort:** Medium

**Requirements:** FR8, FR23, FR31, FR38, FR41

**Acceptance Criteria:**

**Given** valid env config and a monitored wallet
**When** `pnpm dev` starts
**Then** portfolio monitoring, heartbeat reminder evaluation, and reward policy evaluation run on configured intervals
**And** job success/failure is visible in audit events without exposing secrets.

### Story 7.2: Add Local Runtime Smoke Checks

As a developer,
I want repeatable smoke checks for the running frontend and agent,
So that “done” reflects real app behavior.

**Effort:** Medium

**Requirements:** FR13, FR35, FR38, FR39, FR41

**Acceptance Criteria:**

**Given** dev servers are running
**When** smoke checks execute
**Then** they verify `/api/health`, latest portfolio/risk reads, frontend HTTP 200, demo scenario execution, and secret-safe audit output.

### Story 7.3: Make Demo/Testnet Capability Honest

As a user or judge,
I want the UI and docs to state whether each result is simulation-backed or Somnia Testnet-backed,
So that the product does not overclaim live autonomy.

**Effort:** Medium

**Requirements:** FR36, FR39, FR41

**Acceptance Criteria:**

**Given** a flow uses demo fixtures
**When** the dashboard displays the result
**Then** the UI labels it as simulation/demo
**And** testnet mode does not silently show demo data.

### Story 7.4: Wire Or Explicitly Gate Somnia Agent Kit Execution

As an operator,
I want real Somnia execution either wired through the policy-gated adapter or visibly disabled,
So that reward and DMS claims are not falsely presented as complete.

**Effort:** Large

**Requirements:** FR31, FR36, FR38, FR41

**Acceptance Criteria:**

**Given** Somnia Agent Kit adapter config is unavailable
**When** execution-capable flows are viewed or attempted
**Then** the system reports execution disabled and records a fail-closed receipt.

**Given** adapter config is available
**When** an eligible reward claim is run
**Then** the state-changing call passes deterministic policy checks before signing.

### Story 7.5: Finish Dashboard Operational UX

As a user,
I want wallet disconnect, API failure states, refresh behavior, and safety receipts to work predictably,
So that I can operate the MVP without terminal inspection.

**Effort:** Medium

**Requirements:** FR35, FR36, FR38, FR39

**Acceptance Criteria:**

**Given** a wallet is connected
**When** I choose disconnect
**Then** local wallet state and wallet-specific dashboard state are cleared.

**Given** the agent API is unavailable or partially failing
**When** the dashboard loads
**Then** the UI shows subsystem-specific unavailable states and keeps the page usable.

### Story 7.6: Redesign Dashboard IA, Telegram Connect, And Public Chain Config

As a user,
I want RiskGuard organized as a focused multi-section app with smooth account controls, Telegram Connect, and public chain settings loaded from config,
So that setup and operations feel like a polished web app instead of a single overloaded dashboard.

**Effort:** Large

**Requirements:** FR1, FR2, FR3, FR4, FR35, FR36, NFR19, NFR22, NFR24

**Acceptance Criteria:**

**Given** the user opens the frontend on desktop
**When** the dashboard renders
**Then** it uses a persistent left sidebar app shell with focused sections for Overview, Setup, Risk, Heartbeat, Rewards, Receipts, Demo, and Health
**And** the Overview route summarizes status without containing every form and workflow.

**Given** the user opens the frontend on mobile
**When** the dashboard renders
**Then** primary navigation appears as a bottom navigation bar
**And** lower-frequency sections are available through a More sheet or menu.

**Given** the user connects, disconnects, signs out, or returns with prior local state
**When** the account state changes
**Then** the UI shows clear restoring, connected, disconnected, expired, error, and disconnecting states
**And** wallet-specific dashboard state is cleared on disconnect/sign out.

**Given** the user configures Telegram
**When** they choose Connect Telegram
**Then** the dashboard starts a bot deep-link, one-time code, QR/link fallback, or equivalent callback flow
**And** the user is not asked to manually type a Telegram chat id.

**Given** chain metadata is needed by the frontend or agent
**When** the app reads chain id, public RPC URL, explorer URL, native currency, or public contract addresses
**Then** those values come from `config/public-chains.json`
**And** environment variables are reserved for secrets and credentials.

**Given** existing UI can be represented by shadcn/ui primitives
**When** the redesign is implemented
**Then** navigation, account menu, setup forms, dialogs/sheets, tabs, tables, badges, alerts, tooltips, toasts, and loading states use shadcn/ui-style components or local wrappers instead of one-off handcrafted UI.
