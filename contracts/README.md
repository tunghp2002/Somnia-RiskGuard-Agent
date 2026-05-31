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

- `RiskGuardInheritanceRegistry`: `0x84dc6ef1639F198fBD0C4BAEd9A5fc90C59dFEF0`
- deployer: `0x64769A00fB002b7ED192834443C9c819565Ab702`
- transaction: `0x0337a6a51d765f16e67e48df96865fd0daedd74cba976cd7d1c25e1fbc5facc2`
- Reactivity funding transaction: `0x48849791032e4b4a782585daa67738560feb250d6f6e521236883c1e863f4297` (`32 STT`)

RiskGuard hook approval gate deployment on Somnia Testnet:

- `RiskGuardApprovalStore`: `0x134c11CE88272933986c8A7B2C9D3F14158bd427`
- `RiskGuardHookModule`: `0xAF37941610EE34c6DDd2FADD74403c1b401950Db`
- `RiskGuardValidator`: `0x18bAA9B475dB370D746955334C8C58452E305f60`
- deployer: `0x64769A00fB002b7ED192834443C9c819565Ab702`
- `RiskGuardApprovalStore` transaction: `0xc12fc12e00687e4297a1239e865e13d06c64e4e166df177b7cd36b2b6f60f645`
- `RiskGuardHookModule` transaction: `0x193e958d60204f27eb5acc9f6dcf5b0a7b5594d7c469e9f487c39fa92d871205`
- `RiskGuardValidator` transaction: `0xc54e5d6734da450601d8c28f204602704156d36fa1bfaa6556d117d92967a085`
- deployed: hook/store `2026-05-30`, validator `2026-05-31`
- note: `RiskGuardValidator` is the active guard path for Thirdweb ERC-7579 accounts. It validates owner/admin signatures and gates ERC-7579 `execute(bytes32,bytes)` UserOps during `validateUserOp`, including native transfers. `RiskGuardHookModule` is kept for hook experiments, but Thirdweb's published `ModularAccount` does not run hooks on its primary `execute(...)` path.
- note: no Thirdweb contract is forked. The account factory and account implementation stay Thirdweb-published; RiskGuard is installed as a separate ERC-7579 validator module.

For a smart account test install, register the approval route after installing the validator:

```solidity
RiskGuardApprovalStore(0x134c11CE88272933986c8A7B2C9D3F14158bd427).registerAgentAndHook(
  agentAddress,
  0x18bAA9B475dB370D746955334C8C58452E305f60
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

RiskGuard Telegram approval flow:

- `RiskGuardValidator.validateUserOp(...)` is the enforcement point. It blocks risky native transfers, contract calls, approvals, and batches by reverting `PendingApprovalRequired(smartAccount, txHash, signer, riskContext)`.
- EVM revert logs are not persisted, so RiskGuard does not emit an on-chain "pending approval" event before reverting. A contract call to Somnia Agent from inside the same reverting validation would also be rolled back.
- The agent exposes `POST /api/riskguard/pending-approval` for a RiskGuard-aware frontend, wallet, or bundler/RPC proxy to forward decoded `PendingApprovalRequired` data. The agent sends Telegram Approve/Decline buttons.
- On Approve, the agent wallet calls `RiskGuardApprovalStore.submitApproval(smartAccount, txHash)` on-chain. The user can then resubmit the original transaction; the validator consumes the one-time approval.
- On Decline, the agent submits nothing, so the original transaction remains blocked.

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
5. After `lastHeartbeatAt + heartbeatInterval + gracePeriod + timelockPeriod`, Somnia Agents, Reactivity, a keeper, or any caller can trigger distribution.
6. The registry snapshots each protected asset balance once and asks the smart account to execute transfers by beneficiary share.
7. Failed transfers are skipped in agent/reactive mode, leaving that share in the smart account for retries. The manual `executeInheritance` path fails closed on transfer failure.

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
