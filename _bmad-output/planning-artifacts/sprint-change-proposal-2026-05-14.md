# Sprint Change Proposal - Runtime Completion Reset

**Project:** Somnia RiskGuard Agent  
**Date:** 2026-05-14  
**Prepared for:** tug  
**Change trigger:** Six epics are marked `done`, but the running product did not behave as a complete MVP: dashboard state was empty or unreachable, the agent started without doing scheduled work, wallet disconnect was missing, and Somnia/testnet execution remained mostly a boundary rather than a real integration.  
**Approval:** Approved by tug on 2026-05-14.

## 1. Issue Summary

### Problem Statement

The sprint tracker treated implementation scaffolds, demo fixtures, and integration boundaries as completed epic outcomes. This conflicts with the PRD and UX definition of the MVP, which require an operational agentic loop: setup, monitoring, AI risk analysis, Telegram actions, safe reward automation, heartbeat/DMS status, visible safety receipts, and clear simulation versus Somnia Testnet behavior.

### Discovery Context

The issue surfaced during local runtime verification after `pnpm dev`:

- Agent logged `agent runtime started`, but no portfolio, heartbeat, or reward jobs were started from the runtime.
- Frontend displayed limited or missing data because browser API calls could resolve to the wrong host/env key and lacked reliable CORS/LAN behavior.
- Wallet connection could not be disconnected from the dashboard.
- `sprint-status.yaml` marked Epics 1-6 as `done`, despite unresolved MVP-level gaps around real Somnia Agent Kit execution, operator health completeness, and testnet/demo separation.

### Evidence

- `agent/src/main.ts` had job classes available but did not schedule `PortfolioMonitorJob`, `HeartbeatJob`, or `RewardClaimJob`.
- `frontend/src/lib/agent-api.ts` read `NEXT_PUBLIC_AGENT_API_BASE_URL`, while `.env.example` and `.env` used `NEXT_PUBLIC_AGENT_API_URL`.
- Agent server was bound to `127.0.0.1`, making LAN-opened frontend pages unable to call `:3001`.
- `frontend/src/lib/wallet.ts` had connect/sign helpers but no disconnect/reset helper.
- `agent/src/integrations/somnia/somnia-agent-kit.client.ts` defines a policy-gated client, but no concrete Somnia Agent Kit adapter is wired in runtime.
- Verification after emergency runtime patch now passes:
  - `pnpm --dir agent test`: 13 files, 95 tests passed.
  - `pnpm build`: agent, contracts, frontend passed.

## 2. Checklist Results

### 1. Understand Trigger And Context

- [x] 1.1 Triggering story: Epic 6 dashboard/runtime verification exposed that “done” implementation did not produce usable product behavior.
- [x] 1.2 Issue type: Failed approach requiring different solution, plus misunderstanding of original `done` criteria.
- [x] 1.3 Evidence gathered from runtime logs, code inspection, sprint status, build/test output, and current API behavior.

### 2. Epic Impact Assessment

- [x] 2.1 Current affected epic: Epic 6 can remain, but its `done` state is inaccurate until runtime smoke flows and operator state are validated.
- [x] 2.2 Existing epic modifications needed: Add a stabilization epic and reopen/selectively reclassify affected stories as `review` or `in-progress`.
- [x] 2.3 Remaining epics: All epics are marked done, so the issue affects retrospective readiness and MVP acceptance rather than future epic sequencing.
- [x] 2.4 New epic needed: Add Epic 7, “Runtime Integration & MVP Acceptance Hardening.”
- [x] 2.5 Priority: Epic 7 becomes the immediate next work before retrospective, demo recording, or any production/testnet claims.

### 3. Artifact Conflict And Impact Analysis

- [x] 3.1 PRD conflict: MVP success requires a complete agentic loop; current status overstates delivery.
- [x] 3.2 Architecture conflict: Architecture says `agent/src/main.ts` starts API, Telegram, and cron jobs; implementation only recently began scheduling jobs and still lacks concrete Somnia Agent Kit adapter wiring.
- [x] 3.3 UX conflict: UX requires status clarity, safety receipts, and honest simulation/testnet labeling; dashboard needs validated smoke flows and beneficiary/operator completeness.
- [x] 3.4 Secondary artifacts: `sprint-status.yaml`, epic/story artifacts, README/dev instructions, `.env.example`, and CI/smoke scripts need updates.

### 4. Path Forward Evaluation

- [x] 4.1 Direct Adjustment: Viable. Add stabilization/acceptance epic and implement concrete runtime gaps. Effort: Medium. Risk: Medium.
- [x] 4.2 Rollback: Not viable. Existing code is useful; rollback would lose working scaffolds and tests.
- [x] 4.3 PRD MVP Review: Partially viable. Do not reduce core MVP yet, but explicitly classify real Somnia testnet execution as a gated acceptance item with fallback demo scope if adapter integration blocks.
- [x] 4.4 Recommended path: Hybrid. Keep existing scope, add Epic 7, reopen inaccurate completion states, and define acceptance smoke tests before retrospective.

### 5. Proposal Components

- [x] 5.1 Issue summary included.
- [x] 5.2 Epic and artifact impacts documented.
- [x] 5.3 Recommended path included.
- [x] 5.4 MVP impact and action plan defined.
- [x] 5.5 Handoff plan included.

### 6. Final Review And Handoff

- [x] 6.1 Checklist completed.
- [x] 6.2 Proposal drafted for review.
- [x] 6.3 User approval received on 2026-05-14.
- [x] 6.4 `sprint-status.yaml` updated after approval.
- [x] 6.5 Next-step handoff proposed.

## 3. Impact Analysis

### Epic Impact

**Epic 1: Secure Agent Foundation & User Setup**  
Mostly valid, but runtime readiness must include actual scheduler/API reachability and bootstrapped monitored wallet behavior.

**Epic 2: Portfolio Monitoring & AI Risk Engine**  
Implementation exists, but acceptance must require the monitor to run from normal `pnpm dev`, not only from tests or manually instantiated jobs.

**Epic 3: Telegram Alerts & Authenticated Quick Actions**  
Keep as implemented but require end-to-end smoke verification from a runtime-generated risk alert, not only unit/API tests.

**Epic 4: Heartbeat Timer & Dead Man's Switch Protection**  
Contract and service behavior exist, but MVP acceptance must distinguish off-chain simulated DMS state from deployed contract-backed state.

**Epic 5: Safe Reward Claim Automation**  
Policy and outcome handling exist, but “execute eligible reward claims” is not complete until a real adapter or explicit demo-only limitation is documented and reflected in UI.

**Epic 6: Dashboard, Demo Mode & Operator Visibility**  
Dashboard exists and now has runtime fixes, but acceptance must include browser smoke flow: connect, disconnect, load data, run demo, refresh, view receipts, and test LAN/local API connectivity.

**New Epic 7: Runtime Integration & MVP Acceptance Hardening**  
Needed to convert “implemented parts” into a demonstrable MVP and restore trust in sprint status.

### Story Impact

Stories that should be reclassified from `done` to `review` or covered by Epic 7 acceptance:

- `2-1-monitor-portfolio-state-for-configured-wallets`
- `3-2-send-risk-alerts-with-explanation-and-buttons`
- `4-4-enforce-expiry-and-timelock-contract-behavior`
- `5-3-execute-eligible-reward-claims-through-agent-wallet`
- `6-1-build-dashboard-shell-and-wallet-connection`
- `6-3-display-portfolio-risk-heartbeat-and-recent-actions`
- `6-5-show-operator-health-and-secret-safe-logs`

### Artifact Conflicts

**PRD:** No major pivot required, but success criteria must add runtime smoke acceptance and explicitly separate demo-backed versus testnet-backed claims.

**Architecture:** Update runtime section so scheduled jobs, CORS/LAN API access, concrete Somnia adapter status, and smoke scripts are first-class.

**UX:** Update Dashboard/Demo/Operator requirements to include disconnect, API unavailable states, and visible adapter mode.

**Sprint status:** Current `done` status is too optimistic. Add Epic 7 and move retrospective behind Epic 7 completion.

### Technical Impact

- Agent runtime needs scheduling, health, and adapter-mode reporting.
- API needs reliable browser access and secret-safe CORS behavior in development.
- Frontend needs robust API base URL resolution, wallet disconnect/reset, empty/error/loading states, and mode labeling.
- CI/local scripts need smoke checks that run against the real dev/runtime composition, not only isolated unit tests.
- Somnia Agent Kit adapter must be either implemented or honestly marked demo-only with visible UI/README limitations.

## 4. Recommended Approach

### Selected Path

Hybrid: Direct Adjustment plus MVP acceptance reset.

### Rationale

The product does not need a rollback. The existing codebase has useful services, repositories, tests, contracts, and dashboard pieces. The problem is that the sprint definition of done skipped runtime integration and acceptance verification. The safest course is to keep the work, add a stabilization epic, and change completion criteria so stories are only `done` when they work through the normal app path.

### Scope Classification

Moderate.

This needs backlog/status reorganization and a focused implementation pass. It does not require a full PRD rewrite or architecture replacement.

### Effort Estimate

2-4 focused development sessions:

1. Runtime hardening and smoke scripts.
2. Somnia adapter/testnet truth pass.
3. Dashboard UX acceptance polish.
4. End-to-end demo rehearsal and status cleanup.

### Risk Assessment

Medium risk. The main uncertainty is the exact Somnia Agent Kit API surface and whether real reward/portfolio testnet data is available in the hackathon timeframe. Mitigation: make demo mode honest and deterministic, while treating testnet-backed execution as a clearly labeled stretch acceptance if adapter docs/package access blocks.

## 5. Detailed Change Proposals

### Proposal A: Add Epic 7 To Epics Document

**Artifact:** `_bmad-output/planning-artifacts/epics.md`  
**Section:** Epic List

OLD:

```md
### Epic 6: Dashboard, Demo Mode & Operator Visibility

Users and judges can view setup state, portfolio/risk status, heartbeat state, recent actions, health checks, and deterministic demo scenarios.
```

NEW:

```md
### Epic 6: Dashboard, Demo Mode & Operator Visibility

Users and judges can view setup state, portfolio/risk status, heartbeat state, recent actions, health checks, and deterministic demo scenarios.

### Epic 7: Runtime Integration & MVP Acceptance Hardening

The team can trust that the marked-complete MVP works through the normal `pnpm dev` path, with scheduled agent behavior, browser-visible state, honest demo/testnet labeling, and repeatable smoke verification.

**User Outcome:** The dashboard and agent behave as a coherent product instead of separate implemented slices. Operators can run a deterministic demo, inspect live state, and know exactly which flows are simulation-backed versus Somnia Testnet-backed.

**FRs covered:** FR8, FR13, FR14, FR23, FR31, FR35, FR36, FR38, FR39, FR41

**Epic size:** Medium

**Natural dependency:** Must complete after Epics 1-6 and before retrospective/demo finalization.
```

**Rationale:** The original epics describe feature slices but not acceptance hardening across the running system.

### Proposal B: Add Epic 7 Stories

**Artifact:** `_bmad-output/planning-artifacts/epics.md`  
**Section:** After Epic 6 stories

NEW:

```md
## Epic 7: Runtime Integration & MVP Acceptance Hardening

### Story 7.1: Run Agent Jobs In Normal Runtime

As an operator,
I want `pnpm dev` to start scheduled monitoring, heartbeat, and reward jobs,
So that the agent performs work without manual test harnesses.

**Acceptance Criteria:**

Given valid env config and a monitored wallet,
When `pnpm dev` starts,
Then portfolio monitoring, heartbeat reminder evaluation, and reward policy evaluation run on configured intervals
And job success/failure is visible in audit events without exposing secrets.

### Story 7.2: Add Local Runtime Smoke Checks

As a developer,
I want repeatable smoke checks for the running frontend and agent,
So that “done” reflects real app behavior.

**Acceptance Criteria:**

Given dev servers are running,
When smoke checks execute,
Then they verify `/api/health`, latest portfolio/risk reads, frontend HTTP 200, demo scenario execution, and secret-safe audit output.

### Story 7.3: Make Demo/Testnet Capability Honest

As a user or judge,
I want the UI and docs to state whether each result is simulation-backed or Somnia Testnet-backed,
So that the product does not overclaim live autonomy.

**Acceptance Criteria:**

Given a flow uses demo fixtures,
When the dashboard displays the result,
Then the UI labels it as simulation/demo
And testnet mode does not silently show demo data.

### Story 7.4: Wire Or Explicitly Gate Somnia Agent Kit Execution

As an operator,
I want real Somnia execution either wired through the policy-gated adapter or visibly disabled,
So that reward and DMS claims are not falsely presented as complete.

**Acceptance Criteria:**

Given Somnia Agent Kit adapter config is unavailable,
When execution-capable flows are viewed or attempted,
Then the system reports execution disabled and records a fail-closed receipt.

Given adapter config is available,
When an eligible reward claim is run,
Then the state-changing call passes deterministic policy checks before signing.

### Story 7.5: Finish Dashboard Operational UX

As a user,
I want wallet disconnect, API failure states, refresh behavior, and safety receipts to work predictably,
So that I can operate the MVP without terminal inspection.

**Acceptance Criteria:**

Given a wallet is connected,
When I choose disconnect,
Then local wallet state and wallet-specific dashboard state are cleared.

Given the agent API is unavailable or partially failing,
When the dashboard loads,
Then the UI shows subsystem-specific unavailable states and keeps the page usable.
```

**Rationale:** These stories encode the missing “it actually runs” work.

### Proposal C: Update PRD Success Criteria

**Artifact:** `_bmad-output/planning-artifacts/prd.md`  
**Section:** Success Criteria / Technical Success

OLD:

```md
The system reliably monitors portfolio state and relevant on-chain events, produces fast and understandable AI risk analysis through Groq with DeepSeek fallback, and delivers stable Telegram notifications with quick action buttons.
```

NEW:

```md
The system reliably monitors portfolio state and relevant on-chain events through the normal runtime path, produces fast and understandable AI risk analysis through Groq with DeepSeek fallback, and delivers stable Telegram notifications with quick action buttons. MVP completion requires a repeatable smoke check proving that the agent API, scheduled jobs, dashboard reads, demo scenarios, and secret-safe audit timeline work together from `pnpm dev`.
```

**Rationale:** The original wording allowed isolated slices to pass without end-to-end runtime proof.

### Proposal D: Update Architecture Runtime Responsibility

**Artifact:** `_bmad-output/planning-artifacts/architecture.md`  
**Section:** Development Workflow Integration

OLD:

```md
`pnpm dev:agent` runs the agent API, Telegram polling, and scheduled jobs.
```

NEW:

```md
`pnpm dev:agent` runs the agent API, Telegram polling, and scheduled jobs. Runtime startup must log API host/port and scheduler activation, expose health for API/Telegram/RPC/signer/Somnia adapter where possible, and write audit events for job success, skip, and failure states. Local development must support browser API calls from localhost and the active LAN host without opening unsafe public origins.
```

**Rationale:** Makes the architecture’s runtime promise testable.

### Proposal E: Update UX Operational Requirements

**Artifact:** `_bmad-output/planning-artifacts/ux-design-specification.md`  
**Section:** UX Consistency Patterns / Feedback Patterns

OLD:

```md
RiskGuard should treat success, skip, denial, pending, and failure as first-class outcomes.
```

NEW:

```md
RiskGuard should treat success, skip, denial, pending, disconnected, unavailable, and adapter-disabled states as first-class outcomes. The dashboard must allow browser-wallet disconnect, must remain usable when the agent API is unavailable, and must label whether each visible result is simulation-backed, demo-fixture-backed, or Somnia Testnet-backed.
```

**Rationale:** Captures the operational UX failures found during runtime testing.

### Proposal F: Update Sprint Status After Approval

**Artifact:** `_bmad-output/implementation-artifacts/sprint-status.yaml`  
**Section:** `development_status`

OLD:

```yaml
  epic-6: done
  6-5-show-operator-health-and-secret-safe-logs: done
  epic-6-retrospective: optional
```

NEW:

```yaml
  epic-6: review
  6-5-show-operator-health-and-secret-safe-logs: review
  epic-6-retrospective: optional

  epic-7: in-progress
  7-1-run-agent-jobs-in-normal-runtime: review
  7-2-add-local-runtime-smoke-checks: backlog
  7-3-make-demo-testnet-capability-honest: backlog
  7-4-wire-or-explicitly-gate-somnia-agent-kit-execution: backlog
  7-5-finish-dashboard-operational-ux: review
  epic-7-retrospective: optional
```

**Rationale:** Reflects current reality: emergency fixes already addressed parts of 7.1 and 7.5, but the acceptance hardening epic is not complete.

## 6. Implementation Handoff

### Classification

Moderate change.

### Handoff Recipients

- Developer agent: implement Epic 7 stories and smoke checks.
- Product owner/developer: approve sprint-status and epic additions.
- Architect, only if Somnia Agent Kit adapter API requires changing the integration pattern.

### Recommended Implementation Order

1. Approve this change proposal.
2. Update `epics.md` and `sprint-status.yaml` with Epic 7.
3. Create story artifact for `7-2-add-local-runtime-smoke-checks`.
4. Implement smoke script that verifies:
   - agent health endpoint
   - latest portfolio/risk endpoint
   - demo scenario endpoint
   - frontend HTTP 200
   - audit endpoint redaction
5. Create story artifact for `7-4-wire-or-explicitly-gate-somnia-agent-kit-execution`.
6. Either wire the real adapter or update UI/docs to make execution disabled/demo-only explicit.
7. Re-run:
   - `pnpm --dir agent test`
   - `pnpm --dir frontend lint`
   - `pnpm build`
   - smoke script
8. Only then mark Epic 7 done and run retrospectives.

### Success Criteria

The course correction is complete when:

- `pnpm dev` starts frontend, agent API, Telegram polling, and agent jobs.
- Dashboard can connect and disconnect wallet.
- Dashboard displays current portfolio/risk data without terminal inspection.
- Demo scenario controls update visible state and receipts.
- Testnet mode does not silently display simulation data.
- Execution-capable flows are either backed by a real Somnia adapter or visibly disabled/fail-closed.
- Build, tests, and smoke checks pass.
- Sprint status no longer claims complete MVP work before runtime acceptance passes.

## 7. Approval Request

Recommended decision: approve this proposal and treat Epic 7 as the immediate next sprint work before any retrospective or demo-finalization step.

Approval options:

- `yes`: Apply artifact/status changes and start Epic 7 implementation.
- `revise`: Adjust proposal details before applying.
- `no`: Leave sprint artifacts unchanged and continue with current plan.
