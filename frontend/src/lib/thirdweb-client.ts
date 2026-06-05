"use client";

import { createThirdwebClient, defineChain } from "thirdweb";
import { createWallet, type Wallet, type SmartWalletOptions } from "thirdweb/wallets";
import { Config } from "thirdweb/wallets/smart";

import publicChains from "../../../config/public-chains.json";

const publicChain = publicChains.chains[publicChains.defaultChain as keyof typeof publicChains.chains];

export const thirdwebClientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? "";
export const riskGuardAccountSalt = "riskguard-v2-2026-06-01";

export const thirdwebClient = thirdwebClientId
  ? createThirdwebClient({ clientId: thirdwebClientId })
  : null;

export const somniaThirdwebChain = defineChain({
  id: publicChain.chainId,
  name: publicChain.name,
  nativeCurrency: publicChain.nativeCurrency,
  rpc: publicChain.rpcUrl,
  blockExplorers: [
    {
      name: "Somnia Explorer",
      url: publicChain.blockExplorerUrl
    }
  ],
  testnet: true
});

export const thirdwebWallets = [
  createWallet("app.subwallet"),
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow")
] as unknown as Wallet[];

function requireModularAccountContracts() {
  const {
    riskGuardDefaultValidator,
    riskGuardModularAccountFactory,
    riskGuardValidatorModule
  } = publicChain.contracts;

  if (!riskGuardModularAccountFactory || !riskGuardDefaultValidator) {
    throw new Error(
      "ERC-7579 modular account factory and default validator are not configured for this chain."
    );
  }

  return { riskGuardDefaultValidator, riskGuardModularAccountFactory, riskGuardValidatorModule };
}

export function createThirdwebAccountAbstraction(
  options: {
    validator?: "default" | "riskguard";
    sponsorGas?: boolean;
    overrides?: SmartWalletOptions["overrides"];
    sessionKey?: SmartWalletOptions["sessionKey"];
  } = {}
): SmartWalletOptions {
  const {
    riskGuardDefaultValidator,
    riskGuardModularAccountFactory,
    riskGuardValidatorModule
  } = requireModularAccountContracts();
  const validatorAddress =
    options.validator === "default"
      ? riskGuardDefaultValidator
      : riskGuardValidatorModule || riskGuardDefaultValidator;

  return Config.erc7579({
    chain: somniaThirdwebChain,
    factoryAddress: riskGuardModularAccountFactory,
    sponsorGas: options.sponsorGas ?? true,
    validatorAddress,
    ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
    ...(options.overrides ? { overrides: options.overrides } : {})
  });
}
