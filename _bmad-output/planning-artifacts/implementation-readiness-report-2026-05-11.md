---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/prd-validation-report.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
workflowType: 'implementation-readiness'
project_name: 'Somnia RiskGuard Agent'
date: '2026-05-11'
status: 'complete'
completedAt: '2026-05-11'
---

# Implementation Readiness Assessment Report

**Date:** 2026-05-11
**Project:** Somnia RiskGuard Agent

## Document Discovery

### PRD Files Found

**Whole Documents:**
- `prd.md` (32308 bytes, modified 2026-05-10 17:14:40)
- `prd-validation-report.md` (16268 bytes, modified 2026-05-10 20:58:33)

**Sharded Documents:**
- None found.

### Architecture Files Found

**Whole Documents:**
- `architecture.md` (36822 bytes, modified 2026-05-10 21:35:54)

**Sharded Documents:**
- None found.

### Epics & Stories Files Found

**Whole Documents:**
- `epics.md` (38818 bytes, modified 2026-05-11 00:03:31)

**Sharded Documents:**
- None found.

### UX Design Files Found

**Whole Documents:**
- None found.

**Sharded Documents:**
- None found.

### Issues Found

- No duplicate whole/sharded document conflicts found.
- No dedicated UX design document found. This is acceptable for readiness assessment because the PRD and epics document explicitly capture UX-related requirements for dashboard, beneficiary messaging, critical alerts, and demo/testnet distinction.

### Documents Selected For Assessment

- `_bmad-output/planning-artifacts/prd.md`
- `_bmad-output/planning-artifacts/prd-validation-report.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/epics.md`

## PRD Analysis

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

FR15: Telegram alerts can include clear explanation text and quick action buttons.

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

FR35: Users can view setup state, portfolio overview, Risk Score, heartbeat status, and recent actions in a lightweight dashboard.

FR36: Users can distinguish simulated demo behavior from Somnia Testnet-backed behavior.

FR37: The operator can run deterministic demo scenarios for risk alerts, reward claims, heartbeat expiry, and Dead Man's Switch timelock.

FR38: The operator can view subsystem health for monitoring, AI providers, Telegram, RPC, signer, and contracts.

FR39: The operator can inspect secret-safe logs for alerts, risk analysis, policy decisions, and transaction outcomes.

FR40: The system can validate required runtime configuration before agent startup.

FR41: The system can fail closed when required providers, wallets, contracts, or policy checks are invalid.

FR42: The system can keep frontend wallet connection separate from backend agent wallet execution.

FR43: The system can expose audit-friendly action history without revealing secrets.

FR44: The system can frame AI Risk Score output as informational analysis rather than financial advice.

**Total FRs:** 44

### Non-Functional Requirements

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

NFR19: Chain ID, RPC URL, contract addresses, wallet addresses, and provider keys must be environment-driven.

NFR20: Demo simulation mode must clearly distinguish simulated behavior from Somnia Testnet-backed behavior.

NFR21: The agent and dashboard must read contract state consistently for heartbeat, expiry, timelock, beneficiary, and execution status.

NFR22: Dashboard flows must use clear labels and status text for setup, heartbeat, risk, and action history.

NFR23: Beneficiary-facing messages must avoid technical jargon and clearly explain current status, waiting periods, and available actions.

NFR24: Critical alerts must not rely on color alone to communicate severity.

NFR25: Backend, frontend, and contracts must remain separated under `/agent`, `/frontend`, and `/contracts`.

NFR26: Core policy checks must be testable independently from LLM output and Telegram delivery.

NFR27: Contract tests must cover heartbeat renewal, expiry, timelock behavior, beneficiary configuration, safe execution authorization, unauthorized access rejection, and false-trigger prevention.

NFR28: The codebase must use typed configuration and validation to prevent invalid runtime states.

**Total NFRs:** 28

### Additional Requirements

- MVP targets Somnia Testnet first, with local/demo simulation mode for deterministic judging flows.
- Frontend uses browser wallet connection only and must not handle private keys.
- Backend agent uses a dedicated env-loaded agent wallet for constrained safe actions.
- Dead Man's Switch contract scope is minimal: heartbeat, beneficiary, expiry/timelock state, safe execution functions, access control, and readable state.
- Contract implementation prioritizes readability and security over extreme gas optimization.
- Internal code review plus comprehensive automated tests are required for MVP; production/mainnet or high-value use requires external audit.
- MVP explicitly excludes unrestricted trading, arbitrary transfers, unbounded rebalancing, multi-chain support, and licensed financial advice claims.

### PRD Completeness Assessment

The PRD is strong enough to drive implementation. It has complete FR coverage, clear MVP boundaries, Web3-specific requirements, user journeys, and explicit safety constraints. The known weaknesses are non-blocking but should be addressed before final release readiness: NFR4 is not measurable enough, several security NFRs need explicit verification methods, and the fintech/Web3 abuse-case matrix should be tightened for Telegram compromise, beneficiary spoofing, malicious configuration, replay attacks, data handling, and provider/RPC manipulation.

## Epic Coverage Validation

### Coverage Matrix

| FR Number | PRD Requirement | Epic Coverage | Status |
| --- | --- | --- | --- |
| FR1 | Users can connect a browser wallet to identify the monitored Somnia wallet. | Epic 1, Epic 6; Stories 1.5, 6.1 | Covered |
| FR2 | Users can view detected wallet address, network status, and configuration readiness. | Epic 1, Epic 6; Stories 1.5, 6.1 | Covered |
| FR3 | Users can configure risk alert thresholds for portfolio monitoring. | Epic 2, Epic 6; Stories 2.2, 2.5, 6.2 | Covered |
| FR4 | Users can configure Telegram notification settings. | Epic 3, Epic 6; Stories 3.1, 6.2 | Covered |
| FR5 | Users can configure heartbeat interval, grace period, and beneficiary wallet. | Epic 4, Epic 6; Stories 4.2, 6.2 | Covered |
| FR6 | Users can enable or disable automatic small reward claiming. | Epic 5, Epic 6; Stories 5.2, 6.2 | Covered |
| FR7 | Users can configure minimum reward value and maximum gas cost limits for reward claims. | Epic 5, Epic 6; Stories 5.2, 6.2 | Covered |
| FR8 | The agent can monitor configured wallet portfolio state on Somnia. | Epic 2; Story 2.1 | Covered |
| FR9 | The agent can detect relevant portfolio, reward, and risk signal changes. | Epic 2; Story 2.2 | Covered |
| FR10 | The agent can generate an AI Risk Score for a monitored wallet state. | Epic 2; Story 2.3 | Covered |
| FR11 | The agent can explain the main factors behind a Risk Score in user-readable language. | Epic 2; Stories 2.3, 2.4 | Covered |
| FR12 | The agent can retry risk analysis through a fallback AI provider when the primary provider fails. | Epic 2; Story 2.3 | Covered |
| FR13 | Users can view current portfolio status, Risk Score, and recent risk explanations. | Epic 2, Epic 6; Stories 2.1, 2.5, 6.3 | Covered |
| FR14 | The agent can send Telegram alerts when configured risk conditions occur. | Epic 3; Story 3.2 | Covered |
| FR15 | Telegram alerts can include clear explanation text and quick action buttons. | Epic 3; Story 3.2 | Covered |
| FR16 | Users can acknowledge alerts through Telegram. | Epic 3; Story 3.4 | Covered |
| FR17 | Users can request refreshed risk analysis through Telegram. | Epic 3; Story 3.4 | Covered |
| FR18 | Users can approve supported safe actions through authenticated Telegram quick actions. | Epic 3; Stories 3.3, 3.5 | Covered |
| FR19 | The system can reject unauthorized, expired, or replayed Telegram actions. | Epic 3; Stories 3.3, 3.5 | Covered |
| FR20 | Users can create and update heartbeat settings for a monitored wallet. | Epic 4, Epic 6; Stories 4.2, 6.2 | Covered |
| FR21 | Users can perform heartbeat check-ins. | Epic 4; Story 4.2 | Covered |
| FR22 | The agent can detect missed heartbeat deadlines. | Epic 4; Story 4.3 | Covered |
| FR23 | The agent can send heartbeat reminder notifications before Dead Man's Switch activation. | Epic 4; Story 4.3 | Covered |
| FR24 | The system can expose heartbeat status, expiry status, and timelock status. | Epic 4, Epic 6; Stories 4.1, 4.2, 4.4, 4.5, 6.3 | Covered |
| FR25 | The Dead Man's Switch can enter an expired state after missed heartbeat rules are met. | Epic 4; Stories 4.1, 4.4 | Covered |
| FR26 | The Dead Man's Switch can enforce a timelock before beneficiary execution. | Epic 4; Stories 4.1, 4.4 | Covered |
| FR27 | The beneficiary can view safe claim or execution status when the Dead Man's Switch is active. | Epic 4; Story 4.5 | Covered |
| FR28 | The system can prevent Dead Man's Switch execution before configured conditions are met. | Epic 4; Stories 4.1, 4.4, 4.6 | Covered |
| FR29 | The agent can identify claimable small staking or LP rewards. | Epic 5; Story 5.1 | Covered |
| FR30 | The agent can skip reward claims that do not satisfy configured value and gas rules. | Epic 5; Story 5.2 | Covered |
| FR31 | The agent can execute eligible small reward claims through the dedicated agent wallet. | Epic 5; Story 5.3 | Covered |
| FR32 | The system can record each skipped, attempted, failed, or successful on-chain action. | Epic 4, Epic 5, Epic 6; Stories 4.6, 5.4, 6.3 | Covered |
| FR33 | The system can prevent unsupported actions such as arbitrary transfers, unrestricted trading, and unbounded rebalancing. | Epic 2, Epic 3, Epic 5; Stories 2.4, 3.5, 5.5 | Covered |
| FR34 | The system can require deterministic policy approval before any transaction is signed. | Epic 3, Epic 4, Epic 5; Stories 3.5, 4.6, 5.2, 5.3, 5.5 | Covered |
| FR35 | Users can view setup state, portfolio overview, Risk Score, heartbeat status, and recent actions in a lightweight dashboard. | Epic 6; Stories 6.1, 6.2, 6.3 | Covered |
| FR36 | Users can distinguish simulated demo behavior from Somnia Testnet-backed behavior. | Epic 6; Stories 6.1, 6.4 | Covered |
| FR37 | The operator can run deterministic demo scenarios for risk alerts, reward claims, heartbeat expiry, and Dead Man's Switch timelock. | Epic 6; Story 6.4 | Covered |
| FR38 | The operator can view subsystem health for monitoring, AI providers, Telegram, RPC, signer, and contracts. | Epic 6; Story 6.5 | Covered |
| FR39 | The operator can inspect secret-safe logs for alerts, risk analysis, policy decisions, and transaction outcomes. | Epic 6; Story 6.5 | Covered |
| FR40 | The system can validate required runtime configuration before agent startup. | Epic 1; Stories 1.1, 1.2 | Covered |
| FR41 | The system can fail closed when required providers, wallets, contracts, or policy checks are invalid. | Epic 1; Stories 1.1, 1.2, 1.6 | Covered |
| FR42 | The system can keep frontend wallet connection separate from backend agent wallet execution. | Epic 1, Epic 5, Epic 6; Stories 1.5, 5.3, 6.1 | Covered |
| FR43 | The system can expose audit-friendly action history without revealing secrets. | Epic 1, Epic 6; Stories 1.2, 1.3, 1.4, 1.6, 6.5 | Covered |
| FR44 | The system can frame AI Risk Score output as informational analysis rather than financial advice. | Epic 2; Story 2.4 | Covered |

### Missing Requirements

No missing FR coverage found.

### Coverage Statistics

- Total PRD FRs: 44
- FRs covered in epics/stories: 44
- Coverage percentage: 100%

### Coverage Notes

- The epics document intentionally uses corrected wording for FR15 and FR35, matching PRD validation recommendations while preserving requirement intent.
- Some foundational FRs are covered in multiple stories because they are cross-cutting safety controls, not isolated features.

## UX Alignment Assessment

### UX Document Status

No dedicated UX design document was found in `_bmad-output/planning-artifacts`.

### UX Implied By Product Scope

UX is clearly implied. The PRD and epics require a browser wallet dashboard, configuration forms, portfolio/risk overview, Telegram quick actions, beneficiary-safe messaging, critical alert accessibility, demo/testnet distinction, loading/error states, and operator health/log views.

### Alignment Issues

- No blocking UX/architecture misalignment found. Architecture supports a Next.js App Router dashboard with shadcn/ui, Tailwind, feature-based frontend modules, and an agent REST API for setup/state reads.
- Story 6.1 covers dashboard shell, wallet connection, and demo/testnet visibility.
- Story 6.2 covers configuration forms.
- Story 6.3 covers portfolio, risk, heartbeat, recent actions, loading, empty, and error states.
- Story 6.4 covers deterministic demo controls and prevention of silent testnet/simulation mixing.
- Story 6.5 covers operator health and secret-safe logs.
- Story 4.5 covers beneficiary-safe status messaging.

### Warnings

- UX specification is missing even though the product has user-facing dashboard and Telegram flows. This is acceptable for MVP implementation readiness, but a compact UX spec or UI checklist would reduce frontend ambiguity.
- Beneficiary-facing UX deserves special care because Sarah is non-technical. Current stories cover clear status and safe next steps, but visual/content details remain to be decided during implementation.
- Accessibility is represented by NFR22-NFR24 and Story 6.3, but there is no dedicated accessibility checklist.

## Epic Quality Review

### Epic Structure Validation

| Epic | User Value Focus | Independence | Assessment |
| --- | --- | --- | --- |
| Epic 1: Secure Agent Foundation & User Setup | Partial user value with necessary greenfield foundation | Stands alone | Acceptable with caveat |
| Epic 2: Portfolio Monitoring & AI Risk Engine | Strong user value | Depends only on Epic 1 | Pass |
| Epic 3: Telegram Alerts & Authenticated Quick Actions | Strong user value | Depends on Epic 1; best after Epic 2 | Pass |
| Epic 4: Heartbeat Timer & Dead Man's Switch Protection | Strong user value | Depends on Epic 1 | Pass |
| Epic 5: Safe Reward Claim Automation | Strong user value | Depends on Epic 1; integrates with Epic 3 optionally | Pass |
| Epic 6: Dashboard, Demo Mode & Operator Visibility | Strong demo/operator value | Can start with stubs but full value depends on prior epics | Pass |

### Story Quality Assessment

- Story count: 32.
- Every story includes As a / I want / So that structure.
- Every story includes Given / When / Then acceptance criteria.
- Every story includes effort level.
- Every story includes FR traceability.
- Stories are generally sized for one developer agent pass.

### Dependency Analysis

**Epic Dependencies:**
- Epic 1 is the required foundation and has no future dependency.
- Epic 2 can function with Epic 1 outputs and does not require Telegram or dashboard completion.
- Epic 3 can function with stored risk snapshots or trigger events; it does not require future epics.
- Epic 4 can function with Epic 1 foundation and does not require reward automation or dashboard completion.
- Epic 5 can execute and record reward claims without dashboard completion; Telegram notification is optional if configured.
- Epic 6 depends on prior services for full live data, but its stories explicitly allow stubs/demo APIs where needed.

**Within-Epic Dependencies:**
- No forward dependency violations found.
- Story ordering generally builds from foundation to operational behavior.
- Contract stories in Epic 4 are sequenced correctly: baseline contract before expiry/timelock behavior and execution prevention.

### Starter Template Requirement

Architecture specifies a starter approach: pnpm workspace plus focused surface starters for agent, frontend, and Foundry contracts. Epic 1 Story 1 is correctly named `Set Up Initial Project From Starter Template` and includes root workspace registration and script delegation.

### Database/Entity Creation Timing

No centralized database is introduced. JSON persistence is created in Story 1.4 because it is needed for user setup, audit events, nonces, risk snapshots, and later stories. This is acceptable for the chosen architecture, but implementation should avoid creating unused placeholder data structures beyond the repositories needed by current stories.

### Findings By Severity

#### Critical Violations

None.

#### Major Issues

None.

#### Minor Concerns

1. **Epic 1 contains technical foundation work.**
   - Assessment: Acceptable because this is a greenfield Web3 agent project and the stories directly enable safe user setup, runtime validation, and wallet separation.
   - Recommendation: In sprint planning, keep Story 1.1 focused on runnable scaffold only; avoid broad infrastructure expansion.

2. **CI/CD is mentioned in architecture but not directly represented as a story.**
   - Assessment: Not blocking for Agentathon MVP, but automated validation should be added early if implementation velocity allows.
   - Recommendation: Include basic CI setup in Sprint Planning or add a small implementation story if strict readiness standards require it.

3. **UX checklist is absent.**
   - Assessment: Not blocking, but frontend stories may leave visual/content details to implementation judgment.
   - Recommendation: Add a compact UX checklist before dashboard implementation or use Story 6 acceptance criteria as the minimum UX guardrail.

4. **NFR verification details are not fully story-mapped.**
   - Assessment: Security posture is strong, but measurable verification methods from PRD validation remain a follow-up.
   - Recommendation: Add readiness/sprint tasks for replay tests, policy-gate tests, secret scanning, fail-closed tests, and DMS false-trigger tests.

### Best Practices Compliance Checklist

- [x] Epics deliver user value or necessary greenfield enablement.
- [x] Epics can function independently in sequence.
- [x] Stories are appropriately sized.
- [x] No forward dependencies found.
- [x] Data persistence is introduced when first needed.
- [x] Acceptance criteria are clear and testable.
- [x] FR traceability is maintained.

## Summary and Recommendations

### Overall Readiness Status

**READY WITH MINOR GAPS**

Implementation can proceed to sprint planning. The core planning chain is aligned: PRD requirements are complete, architecture is validated, epics/stories cover all FRs, and story quality is strong enough for implementation agents. The remaining gaps are not blockers, but they should become explicit sprint tasks or readiness checks.

### Critical Issues Requiring Immediate Action

None.

### Issues Requiring Attention

1. **NFR verification methods are still under-specified.**
   - Source: PRD validation and readiness review.
   - Impact: QA could interpret security/reliability checks inconsistently.
   - Action: Add sprint tasks or story ACs for secret scanning, fail-closed config tests, Telegram replay/expiry tests, policy-gate tests, audit-log redaction tests, Groq-to-DeepSeek fallback tests, and DMS false-trigger tests.

2. **No dedicated UX specification exists.**
   - Source: Document discovery and UX alignment.
   - Impact: Dashboard and beneficiary UX details may be left to implementation judgment.
   - Action: Create a compact UX checklist before or during dashboard work, covering setup flow, risk status, heartbeat status, beneficiary copy, loading/error states, demo/testnet labeling, and color-independent alerts.

3. **CI/CD is architecturally expected but not story-explicit.**
   - Source: Architecture and epic quality review.
   - Impact: Automated quality gates may be delayed.
   - Action: Add a small sprint task for root CI running agent tests, frontend lint/build, and Foundry tests.

4. **Somnia Agent Kit exact API surface remains implementation-time unknown.**
   - Source: Architecture validation.
   - Impact: Story 1.6 may need adjustment after dependency installation or official docs review.
   - Action: In sprint planning, treat Story 1.6 as a spike-backed implementation story with clear fallback to local wrapper interfaces.

### Recommended Next Steps

1. Run `[SP] Sprint Planning` using `bmad-sprint-planning`.
2. In sprint planning, prioritize Story 1.1 -> Story 1.2 -> Story 1.4 -> Story 1.5 -> Story 1.6 before agent feature work.
3. Add explicit quality tasks for NFR verification: replay tests, policy-gate tests, fail-closed config tests, secret redaction, and Foundry DMS false-trigger tests.
4. Add a compact UX checklist or use `[CU] Create UX` if the dashboard needs stronger design guidance before implementation.
5. Start implementation with `[CS] Create Story` only after sprint planning defines story sequence.

### Final Note

This assessment identified **0 critical issues** and **4 minor/important follow-up items** across requirements, UX, quality gates, and implementation uncertainty. The project is ready to move into sprint planning, with the caveat that security verification and UX clarity must be made explicit before the relevant stories are developed.

**Assessor:** BMAD Implementation Readiness Validator
