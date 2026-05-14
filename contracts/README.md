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

`SomniaDeadManSwitch` holds native token and ERC-20 balances for a configured owner/beneficiary pair. The beneficiary can mark safe execution only after:

1. The heartbeat interval passes.
2. The grace period passes.
3. The timelock period passes.

Owner heartbeat renewal, beneficiary changes, and emergency rescue are blocked after expiry to reduce false-trigger and beneficiary-spoofing risk.
