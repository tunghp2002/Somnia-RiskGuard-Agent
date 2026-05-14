# Epic 4 Context: Heartbeat Timer & Dead Man's Switch Protection

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 4 adds the emergency-protection loop for Somnia RiskGuard Agent: users configure heartbeat rules and a beneficiary, perform check-ins before deadlines, receive reminders before expiry, and expose clear expiry/timelock/beneficiary status without allowing premature or unsafe execution. The smart contract is the authoritative source for Dead Man's Switch activation and timelock state, while the agent owns setup validation, JSON persistence, scheduled checks, Telegram reminders, read APIs, audit events, and deterministic policy decisions.

## Stories

- Story 4.1: Implement Foundry Dead Man's Switch Contract Baseline
- Story 4.2: Configure Heartbeat Settings And Check-Ins
- Story 4.3: Send Heartbeat Reminders Before Expiry
- Story 4.4: Enforce Expiry And Timelock Contract Behavior
- Story 4.5: Expose Beneficiary-Safe Status
- Story 4.6: Prevent Premature Dead Man's Switch Execution

## Requirements & Constraints

Users must be able to create and update heartbeat interval, grace period, timelock, and beneficiary wallet settings for a monitored wallet. Heartbeat check-ins must update the next deadline and record an audit event. The agent must detect approaching deadlines, missed heartbeats, expiry, and timelock state, then expose current heartbeat, expiry, beneficiary, and claim-readiness status for dashboard and beneficiary consumers.

Dead Man's Switch activation must be conservative: reminders and grace periods reduce false triggers, timelock state must be visible, and execution must remain unavailable until every configured condition is satisfied. Beneficiary-facing messages must be simple, avoid technical jargon, include the beneficiary wallet and relevant waiting period, and clearly explain when to return if no action is available.

Every state-changing action must pass deterministic policy checks before signing or execution. Unauthorized callers, premature execution attempts, unsupported actions, missing contract configuration, invalid signer/RPC state, and stale or inconsistent contract state must fail closed and record audit history without leaking secrets. The MVP must not implement unrestricted transfers, trading, rebalancing, or opaque autonomous action.

Automated tests are required for heartbeat renewal, beneficiary configuration, missed heartbeat expiry, timelock behavior, safe execution authorization, unauthorized access rejection, and false-trigger prevention. Agent tests should cover repository validation, status calculation, reminder deduplication, policy denial, API validation, and audit records.

## Technical Decisions

Keep `/contracts`, `/agent`, and `/frontend` boundaries strict. `/contracts` owns on-chain heartbeat, beneficiary, expiry, timelock, access control, and readable state. `/agent` owns persistence, scheduling, API validation, policy checks, Telegram/reminder integration, and Somnia/EVM interaction boundaries. Frontend work is limited to future setup/overview consumers and must call agent APIs rather than reading JSON or contract state directly.

Use Foundry for Solidity compilation and tests. The contract implementation should be minimal, readable, and security-focused rather than gas-optimized. It should avoid unbounded loops and unnecessary storage writes, but not introduce complex optimizations that reduce auditability. Contract build/test scripts should be reachable through the `contracts` package and root workspace delegation.

Use lightweight JSON persistence through repository helpers for heartbeat settings and events. Validate persisted data and external API inputs with zod. Wallet addresses must be validated and checksum-normalized before persistence. Date values are ISO 8601 strings; on-chain integer values returned through APIs are decimal strings where applicable.

REST responses must follow existing agent conventions: success as `{ data, meta }`, failure as `{ error: { code, message, details } }`. Event names should use dot notation such as `heartbeat.checked_in`, `heartbeat.reminder.sent`, `heartbeat.missed`, `deadman.policy.denied`, and `deadman.execution.available`. Audit metadata must stay secret-safe.

Somnia/contract interactions should stay behind integration and service boundaries. Contract state is authoritative for Dead Man's Switch activation; off-chain heartbeat status may guide reminders and API messaging but must not bypass contract state or policy gates for execution availability.

## UX & Interaction Patterns

Heartbeat status should be immediately understandable for demo users: configured/unconfigured, healthy, reminder due, expired, timelock pending, or beneficiary action available. Beneficiary output should avoid jargon and provide a single clear next step, including the next return time when timelock is pending. Critical states must not rely on color alone when surfaced later in the dashboard.

## Cross-Story Dependencies

The contract baseline and tests establish the authoritative state model for later agent reads and policy checks. Heartbeat settings and check-ins create the off-chain state used by reminder jobs. Reminder and missed-heartbeat detection feed expiry/timelock visibility. Beneficiary-safe status depends on both persisted configuration and contract-readable state. Premature-execution prevention depends on the policy module, contract state, and audit repository.
