# RiskGuard Validation Module

RiskGuard is moving from passive LLM portfolio scoring to an active smart-account guard.

## Product Fit

The name "RiskGuard Agent" fits this model better than the old score-only flow:

- "Risk" is represented by deterministic transaction rules.
- "Guard" is enforced by smart-account validation before execution.
- "Agent" reviews risky attempts, explains why they are risky, coordinates Telegram confirmation, and produces auditable approval receipts.

The validation module must not synchronously call any external LLM, Telegram, or external API from `validateUserOp`. ERC-4337 validation needs bounded, deterministic on-chain behavior. Off-chain agent work should happen before the UserOperation is submitted, then the UserOperation can carry an approval proof accepted by the module.

## Guard Rules

Initial user-configurable rules:

- Large native transfer: require approval when `value` exceeds a configured STT/SOMI amount.
- Balance percentage: require approval when `value` exceeds a configured percent of the smart account balance.
- Unlimited approve: require approval for ERC-20 `approve(spender, type(uint256).max)`.
- New contract interaction: require approval before calling a target not yet marked as known for the smart account.

## Proposed Flow

1. User enables RiskGuard on the smart account and configures thresholds. The dashboard requires a linked Telegram first (a warning toast blocks enabling otherwise), so the agent has a confirmation/alert channel.
2. Frontend builds or previews the intended transaction.
3. RiskGuard agent decodes the target, value, and calldata.
4. If no rule is triggered, the transaction proceeds normally.
5. If a rule is triggered, the agent sends a Telegram confirmation request.
6. After approval, the agent or user wallet produces a short-lived signed approval proof.
7. The UserOperation includes the proof in module-specific validation data.
8. The validation module verifies the policy, nonce, expiry, signature, and calldata hash.
9. The smart account executes only if validation passes.

## Contract Shape

As implemented (current): the smart account is a **thirdweb ERC-7579 modular
account** (`thirdweb.modular.v0.0.1`, deployed via `riskGuardModularAccountFactory`).
RiskGuard ships as three on-chain pieces:

- `RiskGuardValidator` (validator module) — enforces policy at `validateUserOp` and
  reverts `PendingApprovalRequired` until a valid approval exists.
- `RiskGuardHookModule` (hook) — re-checks policy in `preCheck` and consumes the
  one-time approval in `postCheck`.
- `RiskGuardApprovalStore` — records agent/Telegram approvals (10-minute TTL,
  one-time use) bridged on-chain by the agent.

Modules are installed via standard ERC-7579 `installModule` (no ERC-6900, no
session-key fallback needed). The same `installModule` mechanism authorizes the
inheritance registry as an executor module — the dashboard bundles install + setup
into a single signed batch (ERC-7579 calltype `0x01`).

Core storage is per smart account:

- native amount threshold
- native balance percent threshold
- agent approval signer or guardian signer
- known target mapping
- nonce/approval replay protection
- module enabled flag

## Non-Goals

- Do not run LLM inference inside `validateUserOp`.
- Do not depend on mutable off-chain API availability for basic validation.
- Do not block every transaction by default; only triggered rules should require approval.
