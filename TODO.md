# Somnia RiskGuard Agent - TODO

## Phase 1: Setup + Core Foundation

### P0 - Repository Foundation
- [x] Create BMAD context files.
  - Role: Orchestrator
  - Estimate: 0.5h
  - Acceptance Criteria: `SPECS.md`, `EPIC.md`, `TODO.md`, `CHANGELOG.md`, `.env.example`, `README.md` exist.
- [x] Create project folder structure.
  - Role: Architect
  - Estimate: 0.5h
  - Acceptance Criteria: `/agent`, `/frontend`, `/contracts`, `/docs`, `/infra`, `/scripts`, `/.github/workflows` exist.
- [x] Create BMAD PRD.
  - Role: PM
  - Estimate: 2h
  - Acceptance Criteria: `_bmad-output/planning-artifacts/prd.md` contains executive summary, success criteria, user journeys, domain requirements, innovation analysis, Web3 requirements, scope, FRs, and NFRs.
- [ ] Initialize Git repository.
  - Role: Developer
  - Estimate: 0.25h
  - Acceptance Criteria: `.git` exists and initial scaffold can be committed with Conventional Commit format.

### P0 - Backend Agent Foundation
- [ ] Scaffold `/agent` Node.js + TypeScript package.
  - Role: Developer
  - Estimate: 1h
  - Acceptance Criteria: package scripts for `dev`, `build`, `lint`, `test`; TypeScript config; app entrypoint.
- [ ] Add env validation module.
  - Role: Developer
  - Estimate: 1h
  - Acceptance Criteria: required env vars validated at boot; secrets never logged.
- [ ] Define core domain types.
  - Role: Architect
  - Estimate: 1h
  - Acceptance Criteria: wallet, portfolio position, risk score, heartbeat, reward claim, and alert action types exist.
- [ ] Add LLM provider interface.
  - Role: Developer
  - Estimate: 1.5h
  - Acceptance Criteria: Groq primary and DeepSeek fallback interfaces are stubbed with typed responses.
- [ ] Add Somnia provider interface.
  - Role: Developer
  - Estimate: 1.5h
  - Acceptance Criteria: ethers v6 provider and signer wiring is typed and env-driven.

### P0 - Contract Foundation
- [ ] Scaffold `/contracts` Solidity project.
  - Role: Developer
  - Estimate: 1h
  - Acceptance Criteria: compile and test scripts exist; Solidity version pinned.
- [ ] Draft DeadManSwitch contract spec.
  - Role: Architect
  - Estimate: 1h
  - Acceptance Criteria: owner, heartbeat interval, grace period, timelock, and safe action model documented before implementation.

### P1 - Frontend Foundation
- [ ] Scaffold `/frontend` Next.js 15 app.
  - Role: Developer
  - Estimate: 1h
  - Acceptance Criteria: App Router project runs locally; Tailwind configured.
- [ ] Add shadcn/ui baseline.
  - Role: Developer
  - Estimate: 0.75h
  - Acceptance Criteria: button, card, input, badge, tabs, and dialog components available.
- [ ] Create dashboard information architecture.
  - Role: Architect
  - Estimate: 1h
  - Acceptance Criteria: setup, overview, alerts, and actions views defined.

### P1 - Quality Gates
- [ ] Add CI workflow skeleton.
  - Role: Tester
  - Estimate: 1h
  - Acceptance Criteria: CI has separate jobs for agent, frontend, and contracts once packages exist.
- [ ] Add security checklist.
  - Role: QA
  - Estimate: 0.75h
  - Acceptance Criteria: env, logging, wallet, contract, and transaction safety checks documented.

### P2 - Demo Planning
- [ ] Define Agentathon demo script.
  - Role: Orchestrator
  - Estimate: 1h
  - Acceptance Criteria: demo path covers setup, monitoring, risk alert, heartbeat expiry simulation, and reward claim simulation.

## Suggested Conventional Commits
- `docs: complete bmad prd`
- `chore: initialize bmad project scaffold`
- `docs: add mvp specs and epic roadmap`
- `chore(agent): scaffold typescript runtime`
- `chore(frontend): scaffold next dashboard`
- `chore(contracts): scaffold dead man switch workspace`
