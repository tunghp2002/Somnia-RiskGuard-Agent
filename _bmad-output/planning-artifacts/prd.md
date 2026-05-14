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
  - SPECS.md
  - EPIC.md
  - TODO.md
  - README.md
  - CHANGELOG.md
documentCounts:
  productBriefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 5
workflowType: 'prd'
classification:
  projectType: blockchain_web3
  domain: fintech
  complexity: high
  projectContext: greenfield
---

# Product Requirements Document - Somnia RiskGuard Agent

**Author:** tug
**Date:** 2026-05-10

## Executive Summary

Somnia RiskGuard Agent is an intelligent on-chain AI Portfolio Guardian for Somnia users who need protection when they are not actively watching their wallets. The product monitors portfolio risk in real time, translates on-chain signals into clear actionable insight, sends Telegram alerts with quick actions, handles constrained routine automation such as small reward claims, and provides emergency protection through a basic Dead Man's Switch. The MVP is designed for Agentathon delivery: useful enough to demonstrate agentic on-chain behavior, narrow enough to remain safe, and structured around explicit user configuration rather than unrestricted autonomy.

### What Makes This Special

RiskGuard Agent is proactive rather than observational. Standard portfolio dashboards show balances, and alert bots notify users after predefined events; RiskGuard Agent combines AI risk analysis, on-chain monitoring, user-approved execution, and unreachable-user protection in one agent. Its core insight is that crypto risk often materializes when users are asleep, traveling, distracted, or unable to act. Users do not need another dashboard to stare at; they need a trustworthy autonomous guardian that notices danger, explains what matters, and acts only within responsible safety limits.

## Project Classification

This is a greenfield `blockchain_web3` product in the `fintech` domain with high complexity. The complexity comes from wallet safety, automated on-chain actions, private key handling, smart contract behavior, Telegram action authorization, and the need to prevent unsafe automation. The MVP must prioritize security, constrained execution, explicit configuration, clear auditability, and non-custodial user trust.

## Success Criteria

### User Success

A demo user can connect a wallet, view portfolio status, and see a real-time AI Risk Score with understandable risk explanations. The user can configure a Heartbeat Timer and basic Dead Man's Switch with a beneficiary wallet and expiry period. The user receives Telegram alerts with clear context and quick action buttons, sees the agent perform a constrained small staking/LP reward claim, and leaves the demo understanding how the system protects assets during extended offline periods.

### Business Success

The MVP is delivered within the 3-week Agentathon window and demonstrates a complete agentic loop: portfolio monitoring, AI reasoning, user notification, and safe on-chain action. The demo video clearly shows setup, risk monitoring, Telegram interaction, reward claiming, and Dead Man's Switch trigger behavior. The project stands out as a practical Somnia Agentic L1 use case by emphasizing real user safety, not speculative automation. Success requires professional presentation, clear autonomy boundaries, and a security-first product narrative.

### Technical Success

The system reliably monitors portfolio state and relevant on-chain events through the normal runtime path, produces fast and understandable AI risk analysis through Groq with DeepSeek fallback, and delivers stable Telegram notifications with quick action buttons. MVP completion requires a repeatable smoke check proving that the agent API, scheduled jobs, dashboard reads, demo scenarios, and secret-safe audit timeline work together from `pnpm dev`. The Dead Man's Switch prevents false triggers, uses proper timelock behavior, and restricts execution to safe pre-approved paths. The codebase maintains clean separation between `/agent`, `/frontend`, and `/contracts`, avoids hard-coded secrets, validates runtime configuration, handles failures explicitly, and remains audit-friendly.

### Measurable Outcomes

- Wallet setup and dashboard overview complete in under 3 minutes during demo.
- Risk Score generation returns within 10 seconds for normal demo conditions.
- Telegram alert delivery succeeds within 15 seconds after a simulated risk event.
- Reward claim automation only executes when configured value and gas thresholds pass.
- Dead Man's Switch demo shows heartbeat configuration, expiry simulation, timelock behavior, and beneficiary path without unsafe fund movement.
- Contract tests cover heartbeat renewal, expiry, timelock execution, unauthorized access, and false-trigger prevention.
- No secrets are committed; all keys and tokens are loaded from environment variables.

## Product Scope

### MVP - Minimum Viable Product

The MVP includes portfolio monitoring, AI Risk Score analysis, Telegram alerts with quick actions, Heartbeat Timer configuration, a basic safe Dead Man's Switch, auto-claiming of small staking/LP rewards, and a lightweight dashboard for configuration and overview.

### Growth Features (Post-MVP)

Post-MVP work includes advanced rebalancing, auto-swap flows, multi-chain support, advanced sentiment analysis, and richer risk models. These features are excluded from the MVP because they increase automation risk and are not required to prove the Agentathon concept.

### Vision (Future)

The long-term vision is a personal AI financial advisor and inheritance protection suite on Somnia: an always-on agent that combines portfolio intelligence, safe automation, emergency protection, and long-term asset continuity.

## User Journeys

### Journey 1: Alex Configures RiskGuard And Acts From Telegram

Alex Chen is a 32-year-old crypto holder and DeFi user on Somnia. He holds significant assets, works full time, and travels often, so he cannot watch charts or protocol updates every day. He opens the RiskGuard dashboard, connects his wallet, reviews detected portfolio positions, sets a risk alert threshold, links Telegram, configures a heartbeat interval, and defines Sarah Chen as his beneficiary for the Dead Man's Switch.

Later, while Alex is traveling, RiskGuard detects a material portfolio risk change. The agent analyzes the situation with AI, assigns a Risk Score, summarizes the reason in plain language, and sends Alex a Telegram alert with quick action buttons. Alex does not need to open a dashboard or inspect raw on-chain data; he can acknowledge the risk, refresh analysis, or approve a safe configured action directly from Telegram.

The value moment is when Alex realizes the system noticed risk before he did and gave him a clear next action without requiring constant attention. This journey requires wallet connection, portfolio indexing, risk scoring, Telegram linking, quick action authorization, and a dashboard that makes setup fast and understandable.

### Journey 2: Alex Misses Heartbeats And Dead Man's Switch Activates

Alex configures RiskGuard before a long trip. He chooses a heartbeat interval, adds Sarah's beneficiary wallet, and confirms the Dead Man's Switch settings. The dashboard shows the next heartbeat deadline and explains that fallback actions are constrained and timelocked.

Alex later misses check-ins. RiskGuard sends multiple reminders through Telegram before expiry. When the heartbeat expires, the system does not immediately perform unsafe actions; it enters the configured Dead Man's Switch flow and exposes the timelock state. Sarah receives a clear notification explaining what happened, what the waiting period means, and what action may become available.

The climax is not instant asset movement; it is safe, explainable activation of a pre-approved fallback path. The journey succeeds only if false triggers are minimized, reminders are clear, timelock behavior is visible, and the beneficiary path is understandable to a non-technical person.

### Journey 3: Sarah Uses The Beneficiary Path Safely

Sarah Chen is Alex's wife and is not highly technical. She receives a RiskGuard notification that Alex's heartbeat has expired and that a Dead Man's Switch timelock has started. The message avoids technical jargon and explains the situation, the configured beneficiary wallet, and the next safe step.

Sarah opens the lightweight beneficiary view or follows the guided Telegram flow. She sees whether the timelock is still pending, whether the claim path is available, and what wallet address will receive assets. The system prevents her from making ambiguous or dangerous choices. If the claim path is not ready, it tells her exactly when to return.

The value moment is Sarah feeling guided rather than overwhelmed. This journey requires simple beneficiary messaging, clear claim status, wallet/address confirmation, timelock visibility, and strong guardrails against accidental or malicious execution.

### Journey 4: RiskGuard Claims Small Rewards Automatically

Alex has small staking or LP rewards available. RiskGuard detects claimable rewards during monitoring and checks configured limits, including minimum reward value, maximum gas cost, and whether auto-claim is enabled. If the reward qualifies, the agent performs the claim and records the action.

Alex receives a Telegram notification showing the claimed reward, estimated value, gas condition, and transaction reference. If thresholds are not met, the agent skips the claim and may summarize why. The journey proves that the agent can take useful on-chain action without expanding into risky autonomous trading.

This journey requires reward detection, gas/value threshold checks, transaction execution, transaction logging, Telegram reporting, and explicit configuration boundaries.

### Journey 5: Developer Demonstrates The Full Agentathon Flow

The developer and hackathon participant prepares a judge-facing demo. The demo starts with the dashboard setup, showing wallet connection, risk settings, Telegram linking, heartbeat configuration, beneficiary setup, and environment-based configuration. The developer then triggers or simulates portfolio monitoring, shows AI risk analysis, receives a Telegram alert, and uses a quick action.

Next, the developer demonstrates reward claiming under safe thresholds. Finally, the developer simulates missed heartbeats and shows the Dead Man's Switch moving through reminder, expiry, timelock, and beneficiary visibility states. The demo ends with logs or dashboard history proving each agent action is traceable.

This journey requires deterministic demo fixtures, safe simulation mode, clear transaction boundaries, visible logs, and a polished narrative that judges can understand quickly.

### Journey 6: Operator Troubleshoots A Failed Integration

During testing or demo preparation, the operator notices that a Telegram alert did not arrive, the LLM provider timed out, or a transaction was rejected. The operator checks logs and dashboard status to see which subsystem failed: monitoring, Groq, DeepSeek fallback, Telegram, RPC provider, signer, or contract interaction.

The system gives enough structured error detail to debug without exposing secrets. If Groq fails, DeepSeek fallback status is visible. If Telegram fails, the failed delivery is logged. If a transaction fails, the reason and safety checks are recorded. This journey requires audit-friendly logging, provider health state, explicit error handling, and secret-safe diagnostics.

### Journey Requirements Summary

These journeys reveal the core capability areas required for the MVP: wallet connection, portfolio monitoring, AI risk scoring, Telegram notification and quick actions, heartbeat configuration, Dead Man's Switch reminders and timelock state, beneficiary-safe claim flow, automatic small reward claiming, demo simulation support, structured logs, and failure diagnostics. They also establish the product's safety boundary: the agent may monitor, explain, notify, claim small configured rewards, and execute pre-approved fallback flows, but it must not perform unrestricted trading, unbounded transfers, or opaque autonomous actions.

## Domain-Specific Requirements

### Compliance & Regulatory

- The MVP must not present itself as licensed financial advice, investment management, or guaranteed asset protection.
- Risk Score output must be framed as informational analysis, not a directive to buy, sell, or trade.
- The agent must require explicit user configuration before any on-chain action can occur.
- The Dead Man's Switch must operate only through pre-approved, user-configured beneficiary and timelock rules.
- The demo must avoid real high-value assets and clearly separate simulation/testnet behavior from production readiness.

### Technical Constraints

- Secrets, private keys, bot tokens, RPC keys, and LLM API keys must only be loaded from environment variables.
- The agent must never log secrets or full private transaction payloads.
- On-chain actions must be bounded by configurable allowlists, value thresholds, gas thresholds, and action-specific validation.
- Telegram quick actions must be authenticated and protected against replay or unauthorized use.
- The system must maintain audit-friendly records of risk analysis requests, alerts, user actions, skipped actions, and executed transactions.
- LLM output must not be trusted directly for transaction execution; deterministic policy checks must gate every action.

### Integration Requirements

- The backend agent must integrate with Somnia RPC through ethers.js v6.
- The AI risk service must use Groq as primary provider and DeepSeek as fallback.
- Telegram integration must support clear alert messages and quick action buttons.
- The frontend dashboard must expose setup and overview state without handling private keys directly in client-side code.
- The Dead Man's Switch contract must expose heartbeat, expiry, timelock, beneficiary, and execution state in a way the agent and dashboard can read reliably.

### Risk Mitigations

- False Dead Man's Switch activation must be reduced through reminders, grace periods, and visible timelock state.
- Unsafe autonomous behavior must be prevented by excluding unrestricted trading, arbitrary transfers, and unbounded strategy execution from MVP.
- Failed LLM, RPC, Telegram, or transaction flows must fail closed and produce actionable diagnostics.
- Reward claiming must execute only when configured minimum reward value and maximum gas cost rules pass.
- Smart contract behavior must be covered by tests for heartbeat renewal, expiry, authorization, timelock behavior, beneficiary execution, and false-trigger prevention.

## Innovation & Novel Patterns

### Detected Innovation Areas

RiskGuard Agent combines four patterns that are usually separate: portfolio monitoring, AI risk interpretation, safe on-chain execution, and beneficiary-oriented emergency protection. The innovative element is not unrestricted autonomy; it is constrained autonomy for high-trust crypto safety workflows. The agent is designed to act when users are unavailable while preserving explicit configuration, timelocks, thresholds, and auditability.

The Dead Man's Switch creates a differentiated safety layer for crypto holders who may be offline for long periods. Instead of treating portfolio protection as a dashboard problem, RiskGuard treats it as an agentic continuity problem: monitor, reason, notify, remind, and activate safe fallback paths when the user cannot respond.

### Market Context & Competitive Landscape

Typical portfolio trackers focus on visibility. Alert bots focus on notifications. DeFi automation tools often optimize yield or trading execution. RiskGuard's market position is different: it focuses on personal asset protection, offline-user risk, and safe continuity. For the Agentathon MVP, the product should avoid claiming to replace custody, financial advisors, or estate planning products; its defensible position is a practical Somnia-native agent that demonstrates responsible autonomous behavior.

### Validation Approach

The innovation should be validated through a complete demo loop: wallet setup, risk monitoring, AI Risk Score generation, Telegram quick action, automatic small reward claim, heartbeat reminders, Dead Man's Switch expiry simulation, timelock visibility, and beneficiary path. The demo must prove that the agent can act without becoming unsafe: every action is bounded, explainable, logged, and configured before execution.

### Risk Mitigation

The main innovation risk is user trust. Users may reject automation if it feels opaque, overpowered, or unsafe. The MVP mitigates this by excluding unrestricted trading, arbitrary transfers, and high-value autonomous actions. LLM output is advisory only and cannot directly authorize transactions. Smart contract behavior is constrained by heartbeat, expiry, timelock, beneficiary, and authorization rules. Telegram actions require authentication and replay protection. Failed provider, LLM, or transaction flows fail closed and produce diagnostic logs.

## Blockchain Web3 Specific Requirements

### Project-Type Overview

Somnia RiskGuard Agent is a Somnia Testnet-first Web3 agent product with local/demo simulation support for Agentathon judging. The system combines a browser-connected user wallet, a dedicated backend agent wallet, Somnia RPC access through ethers.js v6, and a minimal Dead Man's Switch smart contract. The MVP must prove safe agentic on-chain behavior without implying production custody, financial advice, or unrestricted asset management.

### Technical Architecture Considerations

The frontend dashboard uses browser wallet connection only, supporting wallets such as MetaMask, SubWallet, or compatible injected EVM wallets. The dashboard is responsible for user setup, wallet visibility, portfolio overview, heartbeat configuration, and status display. It must not handle or store private keys.

The backend agent uses a dedicated agent wallet loaded from environment variables. This wallet is responsible only for configured safe actions such as small reward claims, heartbeat-related operations, Dead Man's Switch execution paths, and demo/testnet transactions. User wallet and agent wallet responsibilities must remain clearly separated.

The system must support Somnia Testnet as the primary chain environment and a local/demo simulation mode for deterministic hackathon flows. Simulation mode must make demo behavior predictable without hiding which actions are simulated versus testnet-backed.

### Chain Specs

- Primary network: Somnia Testnet.
- Local/demo mode must support deterministic portfolio, reward, risk, heartbeat, and Dead Man's Switch scenarios.
- Chain ID, RPC URL, contract addresses, and wallet addresses must be environment-driven.
- The agent must use ethers.js v6 for provider, signer, contract, and transaction interactions.
- The system must fail closed when RPC configuration, chain ID, signer, or contract address validation fails.

### Wallet Support

- Frontend wallet support is browser-wallet based through injected EVM providers.
- Backend execution uses a dedicated agent wallet from environment variables.
- User private keys must never be entered into or stored by the dashboard.
- Wallet addresses must be validated before saving configuration.
- Transaction execution must always pass deterministic policy checks before signing.

### Smart Contracts

The MVP Dead Man's Switch contract scope is intentionally minimal:
- Heartbeat mechanism.
- Beneficiary configuration.
- Expiry and timelock state management.
- Safe execution functions with proper access control.
- Readable state for dashboard and agent monitoring.

The contract must prioritize simple, readable, and secure implementation over advanced gas optimization. Extreme gas optimization is not required for the Agentathon MVP.

### Security Audit Posture

The MVP requires internal code review and comprehensive automated tests. Production, mainnet deployment, or use with high-value assets requires an external smart contract and system security audit.

Required test coverage includes heartbeat renewal, missed heartbeat expiry, timelock behavior, beneficiary configuration, safe execution authorization, unauthorized access rejection, and false-trigger prevention.

### Gas Optimization

Gas usage should be reasonable, but security and readability take priority. The contract should avoid unnecessary storage writes and unbounded loops, but should not introduce complex gas-saving patterns that reduce auditability or increase implementation risk.

### Implementation Considerations

The MVP must maintain hard separation between frontend setup, backend agent execution, and contract-enforced safety. Environment validation must run before startup. All on-chain action attempts must be logged without secrets. LLM output must never directly control transactions. Every claim, heartbeat, or Dead Man's Switch action must be gated by deterministic configuration and contract state.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Experience-and-safety MVP. The first release must prove that Somnia RiskGuard Agent can deliver a complete protective loop: monitor portfolio state, reason about risk, notify the user, execute only safe configured actions, and demonstrate Dead Man's Switch continuity.

**Resource Requirements:** MVP delivery requires one full-stack developer/operator with smart contract capability, plus focused QA/security review. Core skills required are Node.js/TypeScript, Next.js, Solidity, ethers.js v6, Telegram bot integration, LLM integration, and Web3 security testing.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- Alex configures wallet monitoring, receives a risk alert, and acts through Telegram.
- Alex misses heartbeat reminders and the Dead Man's Switch enters a safe timelock flow.
- Sarah views the beneficiary path in a clear, non-technical flow.
- RiskGuard claims small staking/LP rewards under configured safety thresholds.
- The developer demonstrates monitoring, AI reasoning, safe on-chain action, and DMS simulation to judges.
- The operator diagnoses failed Telegram, LLM, RPC, or transaction flows without exposing secrets.

**Must-Have Capabilities:**
- Portfolio monitoring on Somnia Testnet and local/demo simulation mode.
- AI Risk Score analysis using Groq primary and DeepSeek fallback.
- Telegram alerts with clear explanations and quick action buttons.
- Heartbeat Timer setup with reminders and expiry state.
- Basic Dead Man's Switch contract with beneficiary, timelock, heartbeat, and safe execution state.
- Auto-claim for small staking/LP rewards gated by value, gas, and allowlist rules.
- Lightweight dashboard for wallet connection, setup, overview, heartbeat state, and recent actions.
- Environment-based configuration with no hard-coded secrets.
- Audit-friendly logs for alerts, analysis, skipped actions, and executed transactions.
- Automated tests for contract safety and core agent policy checks.

### Post-MVP Features

**Phase 2 (Post-MVP):**
- Advanced rebalancing and auto-swap flows.
- Multi-chain portfolio support.
- Advanced sentiment analysis and richer risk intelligence.
- More granular user policies and approval workflows.
- Expanded dashboard analytics and historical risk tracking.

**Explicitly Out Of MVP:**
- Full autonomous trading.
- Arbitrary transfers.
- Unbounded portfolio rebalancing.
- Mainnet/high-value production usage.
- Licensed financial advice or custody claims.
- External audit completion.

### Future Vision

**Phase 3 (Expansion):**
Somnia RiskGuard evolves into a personal AI financial advisor and inheritance protection suite on Somnia. The future product combines portfolio intelligence, safe automation, emergency protection, continuity planning, and beneficiary guidance while preserving user control and auditability.

### Risk Mitigation Strategy

**Technical Risks:** The highest-risk areas are smart contract safety, false Dead Man's Switch activation, Telegram action authentication, LLM hallucination, and transaction policy enforcement. The MVP mitigates these through minimal contract scope, timelocks, reminders, deterministic policy gates, replay protection, fail-closed behavior, and automated tests.

**Market Risks:** Users may distrust automated crypto agents if autonomy feels opaque or dangerous. The MVP addresses this by emphasizing constrained automation, clear explanations, explicit setup, visible logs, and safe demo flows rather than yield maximization or trading promises.

**Resource Risks:** The 3-week Agentathon timeline requires a lean implementation. If time compresses, preserve the core demo path first: dashboard setup, risk scoring, Telegram alert, reward claim simulation/testnet action, heartbeat expiry simulation, and DMS timelock visibility. Polish and broader protocol integrations can wait.

## Functional Requirements

### Wallet And User Configuration

- FR1: Users can connect a browser wallet to identify the monitored Somnia wallet.
- FR2: Users can view detected wallet address, network status, and configuration readiness.
- FR3: Users can configure risk alert thresholds for portfolio monitoring.
- FR4: Users can configure Telegram notification settings.
- FR5: Users can configure heartbeat interval, grace period, and beneficiary wallet.
- FR6: Users can enable or disable automatic small reward claiming.
- FR7: Users can configure minimum reward value and maximum gas cost limits for reward claims.

### Portfolio Monitoring And Risk Analysis

- FR8: The agent can monitor configured wallet portfolio state on Somnia.
- FR9: The agent can detect relevant portfolio, reward, and risk signal changes.
- FR10: The agent can generate an AI Risk Score for a monitored wallet state.
- FR11: The agent can explain the main factors behind a Risk Score in user-readable language.
- FR12: The agent can retry risk analysis through a fallback AI provider when the primary provider fails.
- FR13: Users can view current portfolio status, Risk Score, and recent risk explanations.

### Telegram Alerts And User Actions

- FR14: The agent can send Telegram alerts when configured risk conditions occur.
- FR15: Telegram alerts can include clear explanation text and quick action buttons.
- FR16: Users can acknowledge alerts through Telegram.
- FR17: Users can request refreshed risk analysis through Telegram.
- FR18: Users can approve supported safe actions through authenticated Telegram quick actions.
- FR19: The system can reject unauthorized, expired, or replayed Telegram actions.

### Heartbeat And Dead Man's Switch

- FR20: Users can create and update heartbeat settings for a monitored wallet.
- FR21: Users can perform heartbeat check-ins.
- FR22: The agent can detect missed heartbeat deadlines.
- FR23: The agent can send heartbeat reminder notifications before Dead Man's Switch activation.
- FR24: The system can expose heartbeat status, expiry status, and timelock status.
- FR25: The Dead Man's Switch can enter an expired state after missed heartbeat rules are met.
- FR26: The Dead Man's Switch can enforce a timelock before beneficiary execution.
- FR27: The beneficiary can view safe claim or execution status when the Dead Man's Switch is active.
- FR28: The system can prevent Dead Man's Switch execution before configured conditions are met.

### Safe On-Chain Actions

- FR29: The agent can identify claimable small staking or LP rewards.
- FR30: The agent can skip reward claims that do not satisfy configured value and gas rules.
- FR31: The agent can execute eligible small reward claims through the dedicated agent wallet.
- FR32: The system can record each skipped, attempted, failed, or successful on-chain action.
- FR33: The system can prevent unsupported actions such as arbitrary transfers, unrestricted trading, and unbounded rebalancing.
- FR34: The system can require deterministic policy approval before any transaction is signed.

### Dashboard And Demo Operations

- FR35: Users can view setup state, portfolio overview, Risk Score, heartbeat status, and recent actions in a lightweight dashboard.
- FR36: Users can distinguish simulated demo behavior from Somnia Testnet-backed behavior.
- FR37: The operator can run deterministic demo scenarios for risk alerts, reward claims, heartbeat expiry, and Dead Man's Switch timelock.
- FR38: The operator can view subsystem health for monitoring, AI providers, Telegram, RPC, signer, and contracts.
- FR39: The operator can inspect secret-safe logs for alerts, risk analysis, policy decisions, and transaction outcomes.

### Security And Safety Controls

- FR40: The system can validate required runtime configuration before agent startup.
- FR41: The system can fail closed when required providers, wallets, contracts, or policy checks are invalid.
- FR42: The system can keep frontend wallet connection separate from backend agent wallet execution.
- FR43: The system can expose audit-friendly action history without revealing secrets.
- FR44: The system can frame AI Risk Score output as informational analysis rather than financial advice.

## Non-Functional Requirements

### Performance

- Risk Score generation should complete within 10 seconds under normal demo conditions.
- Telegram alerts should be sent within 15 seconds after a simulated or detected risk event.
- Dashboard setup flow should be completable within 3 minutes during demo.
- Portfolio status and heartbeat status should refresh quickly enough for demo users to understand current system state without manual log inspection.

### Security

- Secrets, private keys, bot tokens, RPC keys, and LLM API keys must only be loaded from environment variables.
- The frontend must never request, store, or transmit user private keys.
- The backend agent wallet must be separated from the user's browser wallet.
- LLM output must never directly authorize transactions.
- Every transaction must pass deterministic policy checks before signing.
- Telegram quick actions must be authenticated and protected against replay or unauthorized use.
- Logs must not expose secrets, private keys, full credentials, or sensitive payloads.
- Production, mainnet, or high-value usage requires external security audit before launch.

### Reliability

- The agent must fail closed when required configuration, RPC provider, signer, contract address, Telegram token, or LLM provider is invalid.
- Groq failures must fall back to DeepSeek where possible.
- Failed Telegram, RPC, LLM, and transaction flows must produce actionable diagnostic logs.
- Dead Man's Switch activation must include reminders, grace period handling, and timelock visibility to reduce false activation risk.
- Reward claim automation must skip execution when thresholds or policy checks fail.

### Integration

- Somnia RPC, LLM providers, Telegram, and smart contract integrations must expose health or failure state to the operator.
- Chain ID, RPC URL, contract addresses, wallet addresses, and provider keys must be environment-driven.
- Demo simulation mode must clearly distinguish simulated behavior from Somnia Testnet-backed behavior.
- The agent and dashboard must read contract state consistently for heartbeat, expiry, timelock, beneficiary, and execution status.

### Accessibility

- Dashboard flows must use clear labels and status text for setup, heartbeat, risk, and action history.
- Beneficiary-facing messages must avoid technical jargon and clearly explain current status, waiting periods, and available actions.
- Critical alerts must not rely on color alone to communicate severity.

### Maintainability

- Backend, frontend, and contracts must remain separated under `/agent`, `/frontend`, and `/contracts`.
- Core policy checks must be testable independently from LLM output and Telegram delivery.
- Contract tests must cover heartbeat renewal, expiry, timelock behavior, beneficiary configuration, safe execution authorization, unauthorized access rejection, and false-trigger prevention.
- The codebase must use typed configuration and validation to prevent invalid runtime states.
