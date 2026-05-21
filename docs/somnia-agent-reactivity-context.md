# Somnia Agent And Reactivity Context

Use this file as local implementation context when changing RiskGuard logic that touches Somnia agents, on-chain reactivity, event handling, or chain-specific runtime behavior.

Sources checked on 2026-05-21:

- https://docs.somnia.network/agents
- https://docs.somnia.network/concepts/somnia-blockchain/on-chain-reactivity
- https://docs.somnia.network/developer/reactivity
- https://somnia.network/agents

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

## RiskGuard Fit

For this project, Somnia docs support these implementation choices:

- Portfolio/risk monitoring can keep a simulation or polling fallback, but Somnia-native logic should be written as a reactive event-consumer boundary.
- Contract heartbeat, inheritance, and alert flows should separate user wallet authority from the agent wallet.
- Agent actions should produce auditable receipts with signer, chain ID, request/callback identifiers when available, and advisory risk explanations.
- Testnet behavior should use Somnia Testnet metadata from `config/public-chains.json`.
