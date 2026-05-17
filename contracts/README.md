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

Install Foundry:

```bash
# Ubuntu / WSL
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

```bash
# Windows: Git Bash or WSL
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Foundryup does not support Windows PowerShell or Cmd. If you stay in PowerShell,
download the Windows release archive from
<https://github.com/foundry-rs/foundry/releases> and place `forge.exe` in
`%USERPROFILE%\.foundry\bin`, or set `FOUNDRY_FORGE` to the full path.

The JavaScript workspace installs OpenZeppelin through pnpm; Foundry resolves it through the remapping in `foundry.toml`.

## Dead Man's Switch Summary

`SomniaDeadManSwitch` holds native token and ERC-20 balances for an owner and a
weighted beneficiary list. Beneficiaries are configured as `(address, shareBps)`
pairs and the shares must sum to exactly `10_000` bps.

Each beneficiary can mark safe execution only after:

1. The heartbeat interval passes.
2. The grace period passes.
3. The timelock period passes.

Execution is per beneficiary. The first `markSafeExecution()` call freezes the
native-token pot in `snapshotNativePot`; all later native claims use that frozen
pot, so claim order does not change each beneficiary's entitlement. ERC-20 pots
are snapshotted lazily per token on the first claim for that token.

Owner heartbeat renewal, beneficiary-list changes, and emergency rescue are
blocked after expiry to reduce false-trigger and beneficiary-spoofing risk.
Native rescue excludes `agentBudget`, which is reserved for Somnia Agent
heartbeat requests.

## Somnia Agent Heartbeat

The owner can configure a Somnia Agents platform address and agent ID. The owner
may also set a keeper address. Only the owner or keeper can call
`triggerAgentHeartbeat()`.

`triggerAgentHeartbeat()`:

1. Requires no existing pending agent request.
2. Uses the platform floor deposit plus `agentRewardPerCall * 3`.
3. Debits that amount from `agentBudget`.
4. Creates a Somnia Agent request whose callback is `handleHeartbeatResponse`.

`handleHeartbeatResponse()` may only be called by the configured platform. It
always clears `pendingAgentRequestId`, whether the response succeeds or fails.
On success, it renews the heartbeat only if the switch is still active and no
beneficiary has already marked execution.

## Contract Tests

`contracts/test/DeadManSwitch.t.sol` covers:

- constructor validation for duration bounds and beneficiary share totals
- two-step beneficiary-list replacement
- ownership transfer
- heartbeat expiry and timelock readiness
- per-beneficiary safe execution marking
- native and ERC-20 proportional claims using frozen pot snapshots
- owner rescue before expiry, with `agentBudget` excluded from native rescue
- owner/keeper-only Somnia Agent heartbeat triggering
- pending request rejection and callback reset behavior for success/failure
