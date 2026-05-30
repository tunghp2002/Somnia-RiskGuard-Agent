"use client";

import { createThirdwebClient, defineChain } from "thirdweb";
import { createWallet, type Wallet } from "thirdweb/wallets";

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

export const thirdwebAccountAbstraction = {
  chain: somniaThirdwebChain,
  sponsorGas: true
} as const;
