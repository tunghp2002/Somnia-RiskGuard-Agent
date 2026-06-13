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
pnpm --dir contracts configure:agents
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

This keeps assets in the user's Somnia/Thirdweb smart account so the user can continue day-to-day native-token and ERC-20 usage. The registry must first be installed as an ERC-7579 executor module on that smart account (`installModule(2, registry)`) before it can transfer assets after missed heartbeat conditions; the dashboard does this in the same signed batch as `createPlan`.

The previous standalone locked vault contract has been removed from the active code path because it required users to deposit funds they could no longer use normally.

## Somnia Testnet Deployment

Current Somnia Testnet deployment:

- `RiskGuardInheritanceRegistry`: `0x355D81e993Bc423C81b8fe348fEEe659E738710E`
- deployer: `0x64769A00fB002b7ED192834443C9c819565Ab702`
- transaction: `0xd39b35d744d0c3415e156620372760953a44bb63d0f0c5e2c82338f5405481a6`
- deployed: `2026-06-07`
- Somnia LLM Inference agent configured: `12847293847561029384`
- Somnia agent configuration transaction: `0x985e8f804ae96c323b9b48efd683d646363a75da8b16f92838e245e3bb707569`
- Somnia agent reward per call: `0.1 STT`
- Somnia agent reward configuration transaction: `0x431c007f863c4c924a61ef6cb8840f227c62c5078455a2f6a584a30bf3fef4e9`
- Reactivity funding transaction: `0x829d1dc13c0e134bcf4297822892ca411a9a0b8c6bb56ff1b91f2515123ce848` (`1 STT`)

RiskGuard hook approval gate deployment on Somnia Testnet:

- `RiskGuardApprovalStore`: `0xaCdBb69cb283Cb0feDA1a0D1a3a657D74c35e1e3`
- `RiskGuardHookModule`: `0x296Dc049b35447Aaf9Ea8996667eFB289F257289`
- `RiskGuardValidator`: `0x99eAD10e154693c137B61cEFEB5487db136A342F`
- deployer: `0x64769A00fB002b7ED192834443C9c819565Ab702`
- `RiskGuardApprovalStore` transaction: `0xbbfd38bbbea451e59769df617d235a24e2d57ef4ec37bebe8b50c07c02c64f0d`
- `RiskGuardHookModule` transaction: `0x1c98522de5cf3741d05330df2be6f721cac3577de95bbdeca91950e9cd2255d2`
- `RiskGuardValidator` transaction: `0x7239be53bb71cfe2eef72a2b8bf96c9bb955dbecacd48371123deed9dc36c566`
- deployed: `2026-06-02`
- Somnia LLM Inference agent configured: `12847293847561029384`
- Somnia agent configuration transaction: `0xa16b06471a3e3232d7dc752bcd58a226e34d0da3cb8efb089d540c55bd3f45dc`
- Somnia agent reward per call: `0.1 STT`
- Somnia agent reward configuration transaction: `0xa73254fff006f30449782671ad80629f07685b35f493c952f574c46e521ce48f`
- note: `RiskGuardValidator` is the active guard path for Thirdweb ERC-7579 accounts. It validates owner/admin signatures and gates ERC-7579 `execute(bytes32,bytes)` UserOps during `validateUserOp`, including native transfers. `RiskGuardHookModule` is kept for hook experiments, but Thirdweb's published `ModularAccount` does not run hooks on its primary `execute(...)` path.
- note: no Thirdweb contract is forked. The account factory and account implementation stay Thirdweb-published; RiskGuard is installed as a separate ERC-7579 validator module.

For a smart account test install, register the approval route after installing the validator:

```solidity
RiskGuardApprovalStore(0xaCdBb69cb283Cb0feDA1a0D1a3a657D74c35e1e3).registerAgentAndHook(
  agentAddress,
  0x99eAD10e154693c137B61cEFEB5487db136A342F
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
- The configured Risk Assessment Agent is Somnia's LLM Inference base agent. It receives an `inferString(prompt, system, false, [])` payload with decoded transaction context and should return a concise line beginning with `APPROVE:` or `REJECT:` followed by a reason.
- Somnia's agent platform calls `handleRiskAssessmentResponse(...)`. If the LLM response begins with `APPROVE:`, the validator stores a one-time `agentApprovals[smartAccount][txHash]` entry. The user can then resubmit the original transaction; the validator consumes the agent approval. `REJECT:`, failed requests, or malformed responses leave the transaction blocked and emit the reason for Telegram/status reporting. The agent runtime sends a manual Telegram Approve/Decline fallback when the Somnia agent does not approve.
- If an agent request is pending for the same transaction, `validateUserOp(...)` reverts `AgentReviewPending(smartAccount, txHash, requestId)`.
- For high-risk or manual-review paths, the existing off-chain Telegram flow remains available: a RiskGuard-aware frontend, wallet, bundler, or RPC proxy forwards decoded `PendingApprovalRequired` data to `POST /api/riskguard/pending-approval`; on Approve, the agent wallet calls `RiskGuardApprovalStore.submitApproval(smartAccount, txHash)`.
- On Decline, the agent submits nothing, so the original transaction remains blocked.

The validator intentionally does not call `createRequest` from inside the reverting validation path, because state changes and external calls in a reverted UserOp validation would be rolled back. `requestAgentReview(...)` is the explicit on-chain agent invocation step for the agent-first demo flow.

Agent environment for Telegram approvals:

- `RISK_GUARD_APPROVAL_STORE_ADDRESS`
- `SESSION_KEY_ENCRYPTION_KEY`
- Supabase session-key storage configured for the `session_keys` table
- Telegram bot settings (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, optional `TELEGRAM_WEBHOOK_SECRET`)

RiskGuard does not use a global `RISK_GUARD_AGENT_ADDRESS`. During guard setup, the agent API creates/reuses a per-smart-account `riskguard-approval` session key, returns its address to the frontend, and the smart account registers that address in `ApprovalStore.registerAgentAndHook(...)`. The encrypted private key stays in backend session-key storage and is used only when the user taps Approve in Telegram. Because this key submits the approval as an EOA transaction, it needs a small STT gas balance; the frontend funds it from the user's smart account during RiskGuard setup.

For smart-account transactions sent through the RiskGuard smart-account helper, the frontend also stores a signed pending UserOperation with the agent API when RiskGuard requests Somnia Agent review. Telegram Approve only submits the one-time `ApprovalStore` approval; after that succeeds, the backend relays the already-signed UserOperation to the bundler. The agent does not create a new transfer or gain generic execution authority.

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
- RPC/chain metadata comes from `config/public-chains.json`

After deployment, set:

- `config/public-chains.json` under `chains.somnia-testnet.contracts.riskGuardModularAccountFactory`
- `config/public-chains.json` under `chains.somnia-testnet.contracts.riskGuardDefaultValidator`
- optionally `.env` as `RISK_GUARD_MODULAR_ACCOUNT_FACTORY_ADDRESS`
- optionally `.env` as `RISK_GUARD_DEFAULT_VALIDATOR_ADDRESS`

Configure Somnia Agent IDs after deploying or redeploying the RiskGuard/Inheritance contracts:

```bash
pnpm --dir contracts configure:agents
```

Required environment variables:

- `WALLET_DEPLOYER_PRIVATE_KEY`
- `RISK_GUARD_RISK_ASSESSMENT_AGENT_ID`
- `INHERITANCE_HEARTBEAT_AGENT_ID`
- `INHERITANCE_DISTRIBUTION_AGENT_ID`
- optional `SOMNIA_AGENT_REQUESTER_ADDRESS`; defaults to the known Somnia AgentRequester for chain `5031` or `50312`

`agentId` values and the AgentRequester address are public on-chain configuration. Do not commit a real `WALLET_DEPLOYER_PRIVATE_KEY`.

Deploy the registry with Foundry:

```bash
forge create src/InheritanceRegistry.sol:RiskGuardInheritanceRegistry \
  --rpc-url https://dream-rpc.somnia.network \
  --private-key $WALLET_DEPLOYER_PRIVATE_KEY \
  --broadcast
```

After deployment, set the address in:

- `config/public-chains.json` under `chains.somnia-testnet.contracts.inheritanceRegistry`
- `.env` as `INHERITANCE_REGISTRY_CONTRACT_ADDRESS`

The registry itself does not move funds until each user's smart account has installed the registry as an ERC-7579 executor module (`installModule(2, registry)`). Users should keep day-to-day native tokens and ERC-20s in the smart account, not in this registry.

## Runtime Flow

1. A smart account calls `createPlan(...)` with beneficiaries, protected assets, heartbeat, grace, and timelock. From the dashboard this is a single signed ERC-7579 batch (one UserOp) that also installs the registry as the account's executor module (`installModule(2, registry)`) and funds the per-account agent budget — so the registry can later transfer assets via `executeFromExecutor(...)`. (Authorization uses `installModule`, not Solady `grantRoles`: `grantRoles` is `onlyOwner` and reverts `Unauthorized()` on a self-call inside a batch, whereas `installModule` is `onlyEntryPointOrSelf`.)
2. The registry rejects normal EOAs because they cannot execute `executeFromExecutor(...)`/`executeBatch(...)` later.
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
- allowing `heartbeat = 10 minutes`, `grace = 0`, and `timelock = 0` for the fast testnet demo
- cancelling plans and clearing beneficiaries
- rejecting bad shares, self-beneficiaries, and invalid duration bounds
- refreshing heartbeat deadlines with `checkIn()`
- Somnia agent heartbeat and distribution request tracking
- per-smart-account agent budgets
- native-token and ERC-20 distribution from an authorized smart account
- skip-on-fail distribution behavior

`contracts/test/RiskGuardValidator.t.sol` covers the agent review request →
approval → allowed-UserOp path.

`contracts/test/ApprovalRiskScanner.t.sol` covers the revoke.cash-style
`ApprovalRiskScanner` (`src/riskguard/ApprovalRiskScanner.sol`):

- `quoteScan` batch deposit math (`3 × _agentDeposit` for any non-zero item count)
- `requestScan` storing up to 50 approvals, firing one JSON-API batch call and
  one Parse-Website batch call, then one LLM-Inference batch call on fan-in
- failed/timed-out batch callbacks still reaching a fail-safe inference score
- duplicate/replayed callbacks (no-op + `UnknownAgentRequest`)
- insufficient deposit and `OnlyAgentPlatform` guards

Post-deploy, configure all three agent integrations (RiskGuard, Inheritance,
ApprovalRiskScanner) with `pnpm --dir contracts configure:agents`. The scanner is
read-only (no revoke action) and runs on Somnia; approval **discovery** is done
off-chain by the agent backend via each chain's Blockscout-compatible explorer
API (`module=logs&action=getLogs`), which supports full-range queries. Raw RPC is
used only for live `allowance()` / `isApprovedForAll()` verification (where Somnia
`eth_getLogs` is capped at 1000 blocks, which is why discovery uses the explorer
API instead).

Current ApprovalRiskScanner deployment:

- `ApprovalRiskScanner`: `0xC35634383b0489aC8A3DD0DD396AF5373231a446`
- deploy transaction: `0xa4f8da92523cff1036cf487761e4237d0fdded9988191db1b568233a00c97acd`
- Somnia agent reward per call: `0.01 STT`
- Somnia agent configuration transaction: `0x465b28149bf7e146834b0401b606a4ab77ba44aea383f824ae9b192d279d8ea3`
- Somnia agent reward configuration transaction: `0x5dd3eee780cfadc111914c96692d081ac22b641cbd34975668a9bd2ff215497f`
- batch quote after deploy: `0.18 STT` for any non-zero batch up to 50 approvals
