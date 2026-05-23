# Somnia Agent And Reactivity Context

Use this file as local implementation context when changing RiskGuard logic that touches Somnia agents, on-chain reactivity, event handling, or chain-specific runtime behavior.

Sources checked on 2026-05-21:

- https://docs.somnia.network/agents
- https://docs.somnia.network/concepts/somnia-blockchain/on-chain-reactivity
- https://docs.somnia.network/developer/reactivity
- https://somnia.network/agents

Additional sources checked on 2026-05-23:

- https://docs.somnia.network/developer/building-dapps/account-abstraction
- https://docs.somnia.network/developer/building-dapps/account-abstraction/smart-wallet-app-with-thirdweb
- https://docs.somnia.network/developer/building-dapps/account-abstraction/gasless-transactions-with-thirdw
- https://docs.somnia.network/developer/how-to-guides/thirdweb/somnia-account-abstraction-apps-using-thirdweb-react-sdk

## Implementation Guidance

- Prefer event-driven designs over polling when modeling Somnia Reactivity.
- Treat Reactivity as Testnet-only unless the official docs say otherwise.
- Reactive flows should assume blockchain events and related state are pushed together, not fetched separately through repeated RPC reads.
- Avoid introducing centralized indexer/webhook assumptions for core reactive behavior.
- Avoid granting MCP tools private-key signing capability just to provide documentation context.
- Keep private keys in runtime environment variables only; do not place them in MCP docs/context config.
- For public chain metadata, use `config/public-chains.json` as the source of truth in this repo.

## Somnia Agents

Somnia Agents are consensus-validated compute jobs that can access off-chain data. They can pull from APIs, scrape websites, and run AI inference, while validators independently execute and verify the same work before the result enters the chain.

Important modeling points:

- Agents are not just centralized workers or ordinary backend cron jobs.
- Agent outputs should be treated as consensus-verified chain inputs, not trusted single-server oracle responses.
- AI inference should be deterministic where consensus requires identical validator outputs.
- Agent workflows can involve asynchronous callbacks into contracts.
- EVM compatibility remains important; existing Solidity tooling such as Foundry and Hardhat still applies.

## Native On-Chain Reactivity

Somnia Native On-Chain Reactivity is intended to let contracts respond to on-chain events without off-chain polling or middleware.

Important modeling points:

- Reactivity is currently documented as available only on Testnet.
- Reactions are intended to be included in the same block.
- Reactive handlers should be modeled as decentralized and blockchain-native.
- Avoid designs that depend on a trusted third-party indexer for correctness.
- Benefits called out by the docs include same-block timing, decentralization, trustlessness, MEV resistance, lower external infrastructure complexity, and reliability from blockchain-native handling.

## Developer Reactivity

Somnia Reactivity is a toolkit for event-driven dApps on Somnia. It pushes blockchain data to TypeScript or Solidity applications.

Important modeling points:

- Events and blockchain state are pushed in one atomic notification.
- The docs explicitly contrast this with polling.
- Reactivity supports off-chain TypeScript usage and on-chain Solidity/EVM invocation patterns.
- Subscriptions are the core primitive, with filters, guarantees, and coalescing as relevant design concerns.
- Logic should preserve state consistency assumptions when consuming event notifications.
- On-chain cron subscriptions can target system-generated `Schedule` events for one-off future actions.
- On-chain Reactivity handlers are invoked by the Reactivity precompile (`0x0100`), so contracts should gate handler entrypoints to that caller when the action has settlement authority.

## Account Abstraction And Smart Wallets

Somnia Account Abstraction guidance covers Smart Contract Accounts (SCAs) using tooling such as Thirdweb. The docs position smart wallets as ERC-4337-style accounts that can be used from applications, read balances, send assets, and support gasless or sponsored transactions through Thirdweb infrastructure.

Important modeling points:

- Smart accounts are the right model for "living vault" inheritance: assets remain in a wallet the user can operate day to day, while wallet-level policy can later permit an inheritance module/executor to transfer assets after a missed heartbeat.
- A smart account can transfer both native Somnia tokens and ERC-20 tokens because it is the asset-holding account that executes calls. Native transfers use value-bearing account calls; ERC-20 transfers use token contract calls from the smart account.
- Do not model Somnia Agents as having authority to spend from an EOA. Agents and Reactivity can trigger execution, produce receipts, or verify off-chain data, but asset movement still requires pre-granted authority such as vault custody, ERC-20 allowance/permit, or smart-account policy.
- Thirdweb Account Abstraction can reduce setup friction by batching wallet operations and enabling sponsored/gasless UX, but spending rules must still be explicit and auditable.
- Gasless/sponsored transactions improve onboarding and heartbeat/check-in UX, but sponsorship is not an inheritance authority model by itself. The inheritance executor must still be a bounded smart-account module, session key, guardian, or equivalent pre-approved path.
- Prefer a smart-account inheritance module/factory for production UX over asking users to deposit all assets into a standalone vault. The standalone vault remains useful for guaranteed locked inheritance balances.
- Treat paymaster/sponsor policy as product-critical infrastructure: document who pays, limits, failure modes, and fallback behavior when sponsorship is unavailable.
- Any smart-account inheritance design must define cancel/recovery semantics, active plan lookup, beneficiary changes with delay, executor scope, per-token/native spend limits, and what happens if the smart account changes owner/session-key configuration.

## RiskGuard Fit

For this project, Somnia docs support these implementation choices:

- Portfolio/risk monitoring can keep a simulation or polling fallback, but Somnia-native logic should be written as a reactive event-consumer boundary.
- Contract heartbeat, inheritance, and alert flows should separate user wallet authority from the agent wallet.
- Inheritance distribution should use a Somnia `Schedule` on-chain subscription for the current `timelockEndsAt()` so validator-invoked handler execution can push funds without beneficiary action at distribution time.
- For users who need to keep using funds day to day, prefer a smart-account inheritance path: user assets live in a Thirdweb/Somnia smart wallet, while RiskGuard configures inheritance policy, heartbeat state, beneficiaries, and a bounded executor path.
- Keep the vault path as an explicit "locked protected balance" mode, and keep ERC-20 allowance/permit as a best-effort "flexible balance" mode. Do not imply either one can move native assets out of an ordinary EOA without prior authority.
- Frontend setup should distinguish three asset protection modes: locked vault balance, flexible ERC-20 allowance/permit, and smart-account living vault. The smart-account path is the only path that can preserve day-to-day native-token usage while still enabling automated inheritance execution.
- Agent actions should produce auditable receipts with signer, chain ID, request/callback identifiers when available, and advisory risk explanations.
- Testnet behavior should use Somnia Testnet metadata from `config/public-chains.json`.
