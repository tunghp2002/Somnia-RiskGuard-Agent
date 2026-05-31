"use client";

import { createThirdwebClient, defineChain } from "thirdweb";
import { Config } from "thirdweb/wallets/smart";
import { createWallet, type Wallet } from "thirdweb/wallets";
import type { SmartWalletOptions } from "thirdweb/wallets";

import publicChains from "../../../config/public-chains.json";

const publicChain = publicChains.chains[publicChains.defaultChain as keyof typeof publicChains.chains];

export const thirdwebClientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? "";

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
  const { riskGuardModularAccountFactory, riskGuardDefaultValidator } = publicChain.contracts;

  if (!riskGuardModularAccountFactory || !riskGuardDefaultValidator) {
    throw new Error(
      "ERC-7579 modular account factory and default validator are not configured for this chain."
    );
  }

  return { riskGuardModularAccountFactory, riskGuardDefaultValidator };
}

export function createThirdwebAccountAbstraction(
  options: {
    sponsorGas?: boolean;
    overrides?: SmartWalletOptions["overrides"];
    sessionKey?: SmartWalletOptions["sessionKey"];
  } = {}
): SmartWalletOptions {
  const { riskGuardModularAccountFactory, riskGuardDefaultValidator } = requireModularAccountContracts();

  return Config.erc7579({
    chain: somniaThirdwebChain,
    factoryAddress: riskGuardModularAccountFactory,
    sponsorGas: options.sponsorGas ?? true,
    validatorAddress: riskGuardDefaultValidator,
    ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
    ...(options.overrides ? { overrides: options.overrides } : {})
  });
}
