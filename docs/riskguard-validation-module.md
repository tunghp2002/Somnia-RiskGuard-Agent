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

1. User enables RiskGuard on the smart account and configures thresholds.
2. Frontend builds or previews the intended transaction.
3. RiskGuard agent decodes the target, value, and calldata.
4. If no rule is triggered, the transaction proceeds normally.
5. If a rule is triggered, the agent sends a Telegram confirmation request.
6. After approval, the agent or user wallet produces a short-lived signed approval proof.
7. The UserOperation includes the proof in module-specific validation data.
8. The validation module verifies the policy, nonce, expiry, signature, and calldata hash.
9. The smart account executes only if validation passes.

## Contract Shape

The concrete interface depends on the smart account implementation:

- ERC-6900 modular accounts can install validation hooks/modules.
- Thirdweb smart wallets may require thirdweb-specific module or extension support.
- If the current thirdweb account on Somnia cannot install arbitrary validation modules, RiskGuard needs either a compatible modular account factory or a fallback executor/session-key policy.

Core storage should be per smart account:

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
