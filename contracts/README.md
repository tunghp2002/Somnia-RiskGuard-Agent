# Somnia RiskGuard Contracts

## Toolchain

- Solidity compiler: `0.8.35`
- Build/test runner: Foundry (`forge`)
- Libraries:
  - OpenZeppelin Contracts `@openzeppelin/contracts`

## Commands

```bash
pnpm --dir contracts build
pnpm --dir contracts test
pnpm --dir contracts format
```

`forge` must be installed locally for contract commands. The package scripts use a Node wrapper that works on Ubuntu, WSL, and Windows PowerShell by checking the normal Foundry install path and PATH.

## Smart-Account Inheritance Summary

`RiskGuardInheritanceRegistry` is the active inheritance contract path. It does not custody user funds. Instead, it stores one active inheritance plan per smart account:

- beneficiary addresses and basis-point shares
- heartbeat interval
- optional grace period
- optional beneficiary timelock
- last heartbeat/check-in time
- active/cancelled plan state

This keeps assets in the user's Somnia/Thirdweb smart account so the user can continue day-to-day native-token and ERC-20 usage. A separate smart-account executor/module must be granted bounded authority by that smart account before it can transfer assets after missed heartbeat conditions.

The previous standalone locked vault contract has been removed from the active code path because it required users to deposit funds they could no longer use normally.

## Somnia Testnet Deployment

Current Somnia Testnet deployment:

- `RiskGuardInheritanceRegistry`: `0xb9Fd28DEdE1dA4F1D3e657fdA61F290e8578Ae77`
- deployer: `0x64769A00fB002b7ED192834443C9c819565Ab702`
- transaction: `0xf4ed2bcf67583feb908f50dbfec2a345691f6e331bdaf7f2823411c80f113a1d`
- deployed: `2026-06-01`
- Reactivity funding transaction: `0x48849791032e4b4a782585daa67738560feb250d6f6e521236883c1e863f4297` (`32 STT`)

RiskGuard hook approval gate deployment on Somnia Testnet:

- `RiskGuardApprovalStore`: `0xaCdBb69cb283Cb0feDA1a0D1a3a657D74c35e1e3`
- `RiskGuardHookModule`: `0x296Dc049b35447Aaf9Ea8996667eFB289F257289`
- `RiskGuardValidator`: `0xA258165d82ba1827BF95CFd379e7Da1c8E8A9FA2`
- deployer: `0x64769A00fB002b7ED192834443C9c819565Ab702`
- `RiskGuardApprovalStore` transaction: `0xbbfd38bbbea451e59769df617d235a24e2d57ef4ec37bebe8b50c07c02c64f0d`
- `RiskGuardHookModule` transaction: `0x1c98522de5cf3741d05330df2be6f721cac3577de95bbdeca91950e9cd2255d2`
- `RiskGuardValidator` transaction: `0x06230ada2daaeb5fba87a3f45e2eb537c538666f0e72c24d2cc6d98f489f4065`
- deployed: `2026-06-01`
- note: `RiskGuardValidator` is the active guard path for Thirdweb ERC-7579 accounts. It validates owner/admin signatures and gates ERC-7579 `execute(bytes32,bytes)` UserOps during `validateUserOp`, including native transfers. `RiskGuardHookModule` is kept for hook experiments, but Thirdweb's published `ModularAccount` does not run hooks on its primary `execute(...)` path.
- note: no Thirdweb contract is forked. The account factory and account implementation stay Thirdweb-published; RiskGuard is installed as a separate ERC-7579 validator module.

For a smart account test install, register the approval route after installing the validator:

```solidity
RiskGuardApprovalStore(0xaCdBb69cb283Cb0feDA1a0D1a3a657D74c35e1e3).registerAgentAndHook(
  agentAddress,
  0xA258165d82ba1827BF95CFd379e7Da1c8E8A9FA2
);
```

The frontend and agent use Thirdweb's ERC-7579 beta smart account preset:

```ts
smartWallet(Config.erc7579({
  chain,
  sponsorGas: true,
  factoryAddress,
  validatorAddress: riskGuardValidatorModule,
}));
```

RiskGuard hybrid approval flow:

- `RiskGuardValidator.validateUserOp(...)` is the enforcement point. It blocks risky native transfers, contract calls, approvals, and batches by reverting `PendingApprovalRequired(smartAccount, txHash, signer, riskContext)`.
- For agent-native review, the owner/admin calls `RiskGuardValidator.requestAgentReview(smartAccount, callData)`. The validator pays the Somnia Agent request from `agentBudgetOf[smartAccount]`, calls `IAgentRequester.createRequest(...)`, and records the pending request.
- The configured Risk Assessment Agent receives `assessRisk(smartAccount, txHash, signer, targets, values, data)` payload data and should return `abi.encode(bool approved, string reason)`.
- Somnia's agent platform calls `handleRiskAssessmentResponse(...)`. If approved, the validator stores a one-time `agentApprovals[smartAccount][txHash]` entry. The user can then resubmit the original transaction; the validator consumes the agent approval.
- If an agent request is pending for the same transaction, `validateUserOp(...)` reverts `AgentReviewPending(smartAccount, txHash, requestId)`.
- For high-risk or manual-review paths, the existing off-chain Telegram flow remains available: a RiskGuard-aware frontend, wallet, bundler, or RPC proxy forwards decoded `PendingApprovalRequired` data to `POST /api/riskguard/pending-approval`; on Approve, the agent wallet calls `RiskGuardApprovalStore.submitApproval(smartAccount, txHash)`.
- On Decline, the agent submits nothing, so the original transaction remains blocked.

The validator intentionally does not call `createRequest` from inside the reverting validation path, because state changes and external calls in a reverted UserOp validation would be rolled back. `requestAgentReview(...)` is the explicit on-chain agent invocation step for the agent-first demo flow.

Agent environment for Telegram approvals:

- `RISK_GUARD_APPROVAL_STORE_ADDRESS`
- `SESSION_KEY_ENCRYPTION_KEY`
- Supabase session-key storage configured for the `session_keys` table
- Telegram bot settings (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, optional `TELEGRAM_WEBHOOK_SECRET`)

RiskGuard does not use a global `RISK_GUARD_AGENT_ADDRESS`. During guard setup, the agent API creates/reuses a per-smart-account `riskguard-approval` session key, returns its address to the frontend, and the smart account registers that address in `ApprovalStore.registerAgentAndHook(...)`. The encrypted private key stays in backend session-key storage and is used only when the user taps Approve in Telegram.

Important limitation: "any dApp / any wallet" needs the transaction path to use the RiskGuard validator and a RiskGuard-aware sender surface, wallet provider, bundler, or RPC proxy that forwards failed simulation/revert data to `/api/riskguard/pending-approval`. A purely on-chain subscription to a normal reverted UserOp is not possible with standard EVM logs because reverted logs are discarded.

Thirdweb ERC-7579 modular account deployment on Somnia Testnet:

- `DefaultValidator`: `0x60A206E8927d8e2e02c48e4CdD499fCe66eB82a5`
- `ModularAccountFactory`: `0xE5B5897f84AfE449B2Afc962AD8164425C89AD8D`
- deployer/owner: `0x64769A00fB002b7ED192834443C9c819565Ab702`
- publisher: `0xdd99b75f095d0c4d5112aCe938e4e6ed962fb024`
- `DefaultValidator` transaction: `0x9f1968cc5731968ac87d0dfa62e392294acad17ad8069d47654b2f67b2dfb2ff`
- `ModularAccount` implementation/reference transaction: `0x2fda481ade86f7732d1949a4c71884b355e010a6ecb7c67117829e8341e7d71d`
- `ModularAccountFactory` transaction: `0x713284e24b32fd681502c4d24fbd3d89a96bb1e6ee8015ebefe88a43b8cb5f33`
- deployed: `2026-05-31`
- note: deploy uses Thirdweb's CREATE2 factory `0x4e59b44847b379578588920ca78fbf26c0b4956c`, so `contractAddress` is null in transaction receipts; the Thirdweb SDK returns the resolved deployed contract addresses above.

Deploy or redeploy the Thirdweb ERC-7579 contracts:

```bash
pnpm --dir frontend exec node scripts/deploy-thirdweb-modular.mjs
```

Required environment variables:

- `WALLET_DEPLOYER_PRIVATE_KEY`
- `THIRDWEB_SECRET_KEY` or `THIRDWEB_CLIENT_ID`
- optional `SOMNIA_RPC_URL`; otherwise the script uses `config/public-chains.json`

After deployment, set:

- `config/public-chains.json` under `chains.somnia-testnet.contracts.riskGuardModularAccountFactory`
- `config/public-chains.json` under `chains.somnia-testnet.contracts.riskGuardDefaultValidator`
- optionally `.env` as `RISK_GUARD_MODULAR_ACCOUNT_FACTORY_ADDRESS`
- optionally `.env` as `RISK_GUARD_DEFAULT_VALIDATOR_ADDRESS`

Deploy the registry with Foundry:

```bash
forge create src/InheritanceRegistry.sol:RiskGuardInheritanceRegistry \
  --rpc-url $SOMNIA_RPC_URL \
  --private-key $AGENT_PRIVATE_KEY \
  --broadcast
```

After deployment, set the address in:

- `config/public-chains.json` under `chains.somnia-testnet.contracts.inheritanceRegistry`
- `.env` as `INHERITANCE_REGISTRY_CONTRACT_ADDRESS`

The registry itself does not move funds until each user's smart account has authorized the registry as an executor/module/session key. Users should keep day-to-day native tokens and ERC-20s in the smart account, not in this registry.

## Runtime Flow

1. A smart account calls `createPlan(...)` with beneficiaries, protected assets, heartbeat, grace, and timelock.
2. The registry rejects normal EOAs because they cannot execute `executeBatch(...)` later.
3. The smart account keeps holding and using native tokens/ERC-20s normally.
4. The user refreshes liveness through `checkIn()` or a successful agent heartbeat callback before grace ends.
5. After `lastHeartbeatAt + heartbeatInterval + gracePeriod + timelockPeriod`, the Reactivity schedule calls `onEvent(...)`.
6. `onEvent(...)` does not move funds directly. It creates a Somnia distribution-agent request through `IAgentRequester.createRequest(...)`, using the smart account's funded agent budget.
7. On successful agent callback, `handleDistributionResponse(...)` snapshots each protected asset balance once and asks the smart account to execute transfers by beneficiary share.
8. `triggerDistributionAgent(...)` remains a manual fallback for keepers or demos, but the normal automatic path is Reactivity -> Somnia Agent -> callback -> transfer.
9. Failed transfers are skipped in agent mode, leaving that share in the smart account for retries. The manual `executeInheritance` path fails closed on transfer failure.

## Contract Tests

`contracts/test/InheritanceRegistry.t.sol` covers:

- creating one active plan per smart account
- rejecting a second active plan until cancellation
- updating beneficiaries and timing rules
- allowing `heartbeat = 1 day`, `grace = 0`, and `timelock = 0` for testnet
- cancelling plans and clearing beneficiaries
- rejecting bad shares, self-beneficiaries, and invalid duration bounds
- refreshing heartbeat deadlines with `checkIn()`
- Somnia agent heartbeat and distribution request tracking
- per-smart-account agent budgets
- native-token and ERC-20 distribution from an authorized smart account
- skip-on-fail distribution behavior
