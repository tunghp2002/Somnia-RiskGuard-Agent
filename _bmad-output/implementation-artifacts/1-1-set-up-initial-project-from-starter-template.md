# Story 1.1: Set Up Initial Project From Starter Template

Status: done

## Story

As a developer/operator,
I want the root workspace, package scripts, and baseline configs created,
so that all implementation work starts from one consistent project structure.

## Acceptance Criteria

1. Given the repository root is empty or partially scaffolded, when the workspace foundation is implemented, then root `package.json`, `pnpm-workspace.yaml`, and `tsconfig.json` exist, and `agent`, `frontend`, and `contracts` are registered as pnpm workspace packages.
2. Given a developer runs root scripts, when `pnpm dev`, `pnpm build`, `pnpm test`, or targeted workspace scripts are used, then commands delegate to the correct workspace scripts without mixing toolchains.

## Tasks / Subtasks

- [x] Create root pnpm workspace files (AC: 1, 2)
  - [x] Add root `package.json` with `private: true`, package manager set to pnpm, and scripts for `dev`, `build`, `test`, `lint`, `dev:agent`, `dev:frontend`, `build:agent`, `build:frontend`, `build:contracts`, `test:agent`, `test:contracts`, and `format:contracts`.
  - [x] Add `pnpm-workspace.yaml` with `agent`, `frontend`, and `contracts`.
  - [x] Add root `tsconfig.json` with shared strict TypeScript defaults for agent/frontend extension.
- [x] Scaffold `/agent` as a TypeScript workspace package (AC: 1, 2)
  - [x] Add `agent/package.json` with dev/build/test/lint scripts.
  - [x] Add `agent/tsconfig.json` extending the root config.
  - [x] Add `agent/vitest.config.ts`.
  - [x] Add placeholder `agent/src/main.ts` and `agent/src/index.ts` only if they do not already exist.
- [x] Scaffold `/frontend` as the Next.js workspace boundary (AC: 1, 2)
  - [x] Add or align `frontend/package.json`.
  - [x] Add or align `frontend/next.config.ts`, `frontend/tsconfig.json`, `frontend/eslint.config.mjs`, `frontend/postcss.config.mjs`, and `frontend/components.json`.
  - [x] Prefer the architecture target `frontend/src/app`, `frontend/src/components`, `frontend/src/features`, and `frontend/src/lib`; if keeping existing `frontend/app`, document the variance in completion notes.
- [x] Scaffold `/contracts` as the Foundry workspace boundary (AC: 1, 2)
  - [x] Add `contracts/package.json` that wraps Foundry commands: `build`, `test`, `format`, and optional `clean`.
  - [x] Add `contracts/foundry.toml`.
  - [x] Keep Foundry-owned files under `contracts/src`, `contracts/test`, and `contracts/script`.
- [x] Protect security and repo hygiene (AC: 1)
  - [x] Do not commit or hardcode secrets from `.env`.
  - [x] Update `.env.example` only if new non-secret variable names are needed for scripts.
  - [x] Leave existing BMAD artifacts and root context files intact.
- [x] Verify workspace behavior (AC: 2)
  - [x] Run syntax/format checks available without installing missing network dependencies.
  - [x] If dependency installation is needed and network is blocked, document the exact command to run rather than faking verification.
  - [x] Confirm root scripts delegate to workspace scripts.

### Review Findings

- [x] [Review][Patch] Frontend scaffold is not runnable as a Next App Router app [frontend/package.json:7]
- [x] [Review][Patch] shadcn/Tailwind config references missing globals, utils helper, and Tailwind config [frontend/components.json:8]
- [x] [Review][Patch] ESLint flat config likely imports an invalid shape from `eslint-config-next` [frontend/eslint.config.mjs:1]
- [x] [Review][Patch] Agent entrypoint uses a Windows-unsafe `import.meta.url` comparison [agent/src/main.ts:5]
- [x] [Review][Patch] Root recursive scripts use `--if-present`, which can hide missing workspace scripts [package.json:7]

## Dev Notes

This is a greenfield foundation story. It must create the runnable project scaffolding only; do not implement portfolio monitoring, Telegram, Dead Man's Switch logic, reward claiming, or dashboard feature UI in this story.

Current repo state observed before story creation:
- Root has `.env`, `.env.example`, `.gitignore`, `.editorconfig`, `.mcp.json`, `README.md`, `SPECS.md`, `EPIC.md`, `TODO.md`, `CHANGELOG.md`, and scaffold directories.
- Existing workspace folders: `agent`, `frontend`, `contracts`, `docs`, `infra`, `scripts`.
- `package.json`, `pnpm-workspace.yaml`, root `tsconfig.json`, `agent/package.json`, `frontend/next.config.ts`, and `contracts/foundry.toml` do not exist yet.
- This directory is not currently a Git repository, so do not rely on git history or commits for implementation context.

### Technical Requirements

- Use pnpm as the single JavaScript/TypeScript package manager.
- Register all three workspace packages in `pnpm-workspace.yaml`: `agent`, `frontend`, `contracts`.
- Keep `/contracts` in pnpm only for script orchestration; Solidity build/test remains Foundry-owned.
- Use TypeScript for root-shared config, `/agent`, and `/frontend`.
- Use Foundry for Solidity build/test/script workflows.
- Use Next.js App Router + Tailwind + shadcn/ui as the intended frontend foundation.
- Use no hardcoded secrets. `.env` exists locally and must not be read into generated files.

### Architecture Compliance

Follow these decisions exactly:
- `/agent`: Node.js + TypeScript backend agent.
- `/frontend`: Next.js App Router dashboard.
- `/contracts`: Solidity Dead Man's Switch contracts with Foundry.
- Root workspace orchestrates scripts for agent, frontend, and contracts.
- Contract build/test/deploy scripts are delegated to Foundry.
- Agent entrypoint should be `agent/src/main.ts`; `agent/src/index.ts` exports reusable modules for tests/scripts.
- Frontend is setup/overview only; it must never handle private keys.
- Backend agent wallet execution is future work and must remain env-driven.

Source references:
- [architecture.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/architecture.md) sections: Starter Template Evaluation, Project Structure & Boundaries, Implementation Patterns & Consistency Rules.
- [epics.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/epics.md) Story 1.1 and Additional Requirements.
- [implementation-readiness-report-2026-05-11.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/implementation-readiness-report-2026-05-11.md) Summary and Recommendations.

### Library / Framework Requirements

Do not install broad feature dependencies in this story unless needed for scaffold validity. The architecture later expects:
- Agent runtime dependencies: `ethers`, `viem`, `zod`, `dotenv`, `pino`, `node-cron`.
- Agent dev dependencies: `typescript`, `tsx`, `vitest`, `@types/node`.
- Frontend: Next.js 15 App Router, Tailwind, shadcn/ui.
- Contracts: Foundry/Forge, not Hardhat.

If package installation is performed, use pnpm only. Do not generate npm/yarn/bun lockfiles.

Latest docs checked for this story:
- pnpm workspace config: `pnpm-workspace.yaml` defines the workspace root and `packages`; root package is always included. https://pnpm.io/pnpm-workspace_yaml
- Next.js `create-next-app`: supports pnpm, TypeScript, Tailwind, App Router, `src` directory, import alias, `--skip-install`, and `--disable-git`. https://nextjs.org/docs/app/api-reference/cli/create-next-app
- shadcn/ui Next install: use `pnpm dlx shadcn@latest init` for existing projects and add components with `pnpm dlx shadcn@latest add ...`. https://ui.shadcn.com/docs/installation/next
- Foundry `forge init`: supports `--force`, `--no-git`, and `--empty`; `forge build` and `forge test` are the contract workflow. https://getfoundry.sh/forge/reference/init/
- Foundry config: `foundry.toml` belongs at the project root for the Foundry project, here `contracts/foundry.toml`. https://getfoundry.sh/config/overview/

### File Structure Requirements

Expected files to create or align:

```text
package.json
pnpm-workspace.yaml
tsconfig.json
agent/package.json
agent/tsconfig.json
agent/vitest.config.ts
agent/src/main.ts
agent/src/index.ts
frontend/package.json
frontend/next.config.ts
frontend/tsconfig.json
frontend/eslint.config.mjs
frontend/postcss.config.mjs
frontend/components.json
contracts/package.json
contracts/foundry.toml
```

Expected package script direction:

```json
{
  "dev": "pnpm --parallel dev",
  "build": "pnpm -r build",
  "test": "pnpm -r test",
  "lint": "pnpm -r lint",
  "dev:agent": "pnpm --dir agent dev",
  "dev:frontend": "pnpm --dir frontend dev",
  "build:contracts": "pnpm --dir contracts build",
  "test:contracts": "pnpm --dir contracts test",
  "format:contracts": "pnpm --dir contracts format"
}
```

Use ASCII in new files. Keep markdown/docs changes minimal unless required by the story.

### Testing Requirements

Minimum verification for this story:
- `pnpm-workspace.yaml` includes exactly the three workspace packages required by architecture.
- Root `package.json` scripts reference workspace scripts instead of direct mixed tool invocations.
- `agent/package.json`, `frontend/package.json`, and `contracts/package.json` each expose the scripts root delegates to.
- `contracts/package.json` delegates to `forge build`, `forge test`, and `forge fmt`.
- No secrets from `.env` appear in committed/generated files.

Preferred commands if tools are installed:

```powershell
pnpm --version
pnpm -r --if-present lint
pnpm -r --if-present test
pnpm --dir contracts build
pnpm --dir contracts test
```

If `pnpm`, `forge`, or network access is unavailable, record that limitation in the Dev Agent Record and still validate file content by inspection.

### Project Structure Notes

Architecture prefers `frontend/src/app`, but the current repo has `frontend/app`, `frontend/components`, `frontend/lib`, `frontend/public`, and `frontend/styles`. For Story 1.1, either:
- migrate scaffold directories toward `frontend/src/...`, or
- keep existing folders and document the variance for the dashboard story to resolve.

Do not delete existing `.gitkeep` files unless the directory receives real files and removal is clearly harmless.

### Previous Story Intelligence

No previous story exists. This is the first implementation story.

### Git Intelligence Summary

No git repository was detected in `C:/Users/T/Subwallet/Somnia`; no commit history is available.

### Project Context Reference

No `project-context.md` was found. Use these planning artifacts as the source of truth:
- [prd.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/prd.md)
- [architecture.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/architecture.md)
- [epics.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/epics.md)
- [implementation-readiness-report-2026-05-11.md](C:/Users/T/Subwallet/Somnia/_bmad-output/planning-artifacts/implementation-readiness-report-2026-05-11.md)

## Dev Agent Record

### Agent Model Used

TBD by dev agent.

### Debug Log References

- `pnpm.cmd --version` initially failed after root `packageManager` was set to `pnpm@11.0.0` because local Node is `v22.11.0`; corrected root `packageManager` to `pnpm@10.23.0`.
- `pnpm.cmd --version` passed after correction and reported `10.23.0`.
- `pnpm.cmd -r --if-present lint` and `pnpm.cmd -r --if-present test` were attempted. They could not complete because workspace dependencies are not installed and Foundry is not installed; this is expected for the scaffold-only story before dependency installation.
- `forge --version` failed because Foundry is not installed on this machine.
- PowerShell JSON parsing passed for root, agent, frontend, and contracts `package.json` files.
- PowerShell JSON parsing passed for root, agent, and frontend `tsconfig.json` files.
- Secret-pattern scan against newly created scaffold files returned no matches.
- Code review patch validation passed: JSON parsing remained valid, patched files had no secret-pattern matches, root `package.json` no longer contains `--if-present`, and required frontend scaffold/support files exist.

### Completion Notes List

- Story context created from PRD, architecture, epics, readiness report, sprint status, current filesystem state, and current official docs for pnpm, Next.js, shadcn/ui, and Foundry.
- Implemented root pnpm workspace scaffold with `agent`, `frontend`, and `contracts` workspace packages.
- Added root TypeScript defaults and workspace package scripts for agent, frontend, and Foundry contracts.
- Added minimal agent TypeScript entry/export files for later runtime wiring.
- Added frontend Next.js/shadcn/Tailwind configuration boundary and created `frontend/src` scaffold directories while preserving existing scaffold directories.
- Added contracts Foundry config and pnpm wrapper scripts.
- Full dependency-backed lint/test/build validation is pending `pnpm install` and Foundry installation.
- Resolved code review findings by adding minimal App Router files, Tailwind config, shadcn `cn()` utility, valid ESLint flat config placeholder, Windows-safe agent entrypoint check, and fail-fast root recursive scripts.

### File List
	
- `_bmad-output/implementation-artifacts/1-1-set-up-initial-project-from-starter-template.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `agent/package.json`
- `agent/tsconfig.json`
- `agent/vitest.config.ts`
- `agent/src/main.ts`
- `agent/src/index.ts`
- `frontend/package.json`
- `frontend/next.config.ts`
- `frontend/tsconfig.json`
- `frontend/eslint.config.mjs`
- `frontend/postcss.config.mjs`
- `frontend/components.json`
- `frontend/src/app/.gitkeep`
- `frontend/src/app/globals.css`
- `frontend/src/app/layout.tsx`
- `frontend/src/app/page.tsx`
- `frontend/src/components/ui/.gitkeep`
- `frontend/src/features/.gitkeep`
- `frontend/src/lib/.gitkeep`
- `frontend/src/lib/utils.ts`
- `frontend/tailwind.config.ts`
- `contracts/package.json`
- `contracts/foundry.toml`

### Change Log

- 2026-05-11: Implemented Story 1.1 workspace starter scaffold and moved story to review.
- 2026-05-11: Applied code review patches and marked Story 1.1 done.
