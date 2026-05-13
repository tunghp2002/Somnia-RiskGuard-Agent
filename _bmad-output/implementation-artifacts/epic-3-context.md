# Epic 3 Context: Telegram Alerts & Authenticated Quick Actions

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 3 enables the agent to notify a linked Telegram chat when risk conditions are detected and to process authenticated quick actions without letting Telegram bypass local safety controls. The result should support the demo loop from portfolio monitoring to AI risk explanation to user response, while preserving fail-closed behavior, auditability, and replay protection.

## Stories

- Story 3.1: Configure And Link Telegram Notifications
- Story 3.2: Send Risk Alerts With Explanation And Buttons
- Story 3.3: Sign And Validate Telegram Callback Payloads
- Story 3.4: Support Acknowledge And Refresh Risk Actions
- Story 3.5: Route Safe Action Approvals Through Policy Gates

## Requirements & Constraints

Telegram settings must bind a monitored wallet/user to a Telegram chat so alerts go to the intended recipient. Bot configuration is environment-driven; if the token/chat configuration is missing or invalid, Telegram health must report failure and alert sending must not be attempted.

Risk alerts are triggered when the persisted risk threshold is exceeded. Messages must include Risk Score, severity, short explanation, and quick action buttons. Failed Telegram delivery must produce diagnostic logs and audit events, and must not retry or execute unsafe actions automatically.

Quick action payloads must include action type, user ID, nonce, expiry, and signature. Expired, replayed, malformed, unsigned, wrong-user, or wrong-chat callbacks must fail closed and record a rejection without side effects.

Supported actions for this epic are alert acknowledgment, refreshed risk analysis, and safe-action approval routing. Acknowledge marks the alert as acknowledged and confirms to the user. Refresh triggers risk analysis from the latest portfolio snapshot and sends the refreshed result back to Telegram. Safe-action approvals must be routed through deterministic policy gates before any execution path can sign or submit a transaction.

Unsupported actions such as arbitrary transfers, unrestricted trading, and unbounded rebalancing are outside MVP scope and must be rejected with a clear explanation. LLM output remains advisory only and can never authorize execution.

## Technical Decisions

Agent code owns Telegram polling/integration, callback validation, nonce persistence, audit records, policy gates, and local REST state reads. Use zod for Telegram callback and setup payload validation. Use JSON persistence under `agent/src/persistence/data` only through repository helpers. Use append-friendly audit events for notification, callback, policy, and failure outcomes.

Telegram callback signing must use an environment-loaded secret or bot token material without persisting secrets. Nonces must be stored and consumed atomically enough for the MVP JSON repository model. Callback TTL must be enforced in validation, and replay attempts must be denied after a nonce is consumed.

Policy decisions include `allowed`, `reason`, `policyId`, `createdAt`, `toolName`, `signerAddress`, `chainId`, and calldata summary. State-changing Somnia Agent Kit calls must remain behind deterministic local policy checks; this epic may implement policy routing and denial/approval records before later reward/contract execution exists.

API responses must keep the existing `{ data, meta }` and `{ error: { code, message, details } }` shapes. Logs and audit metadata must redact or avoid secrets, private keys, bot tokens, signatures, and raw credentials.

## UX & Interaction Patterns

Telegram alerts should be readable without a dashboard: concise title, score, severity, explanation, and action buttons. Critical state must not rely on color. User-facing rejection or confirmation messages should be clear and non-technical.

## Cross-Story Dependencies

Story 3.1 enables delivery and binding. Story 3.2 depends on risk snapshots from Epic 2. Story 3.3 underpins all quick actions. Story 3.4 depends on callback validation and Epic 2 risk analysis. Story 3.5 depends on callback validation and policy gate foundations, with real execution remaining constrained by later reward/contract epics.
