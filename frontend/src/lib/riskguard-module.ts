import { AbiCoder, parseUnits } from "ethers";
import {
  getContract,
  prepareContractCall,
  sendAndConfirmTransaction,
} from "thirdweb";
import { EIP1193, smartWallet, type Account } from "thirdweb/wallets";

import {
  createThirdwebAccountAbstraction,
  somniaThirdwebChain,
  thirdwebClient,
} from "@/lib/thirdweb-client";

import type { RiskGuardConfig } from "@/features/dashboard/types";

const moduleTypeHook = 4n;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const installHookGasLimit = 2_500_000n;
const registerApprovalRouteGasLimit = 500_000n;
type HexAddress = `0x${string}`;

function getEthereumProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No browser wallet detected.");
  }

  return window.ethereum;
}

function thresholdConfig(config: RiskGuardConfig) {
  const largeTransferEnabled = config.selectedRules.includes("large-transfer");

  if (!largeTransferEnabled) {
    return { mode: 0, value: 0n };
  }

  const threshold = config.largeTransferThreshold.trim();
  if (!threshold) {
    throw new Error("Enter a RiskGuard transfer threshold before installing the module.");
  }

  if (config.largeTransferMode === "percent") {
    return {
      mode: 1,
      value: BigInt(Math.round(Number(threshold) * 100)),
    };
  }

  return {
    mode: 0,
    value: parseUnits(threshold, 18),
  };
}

function encodeHookInitData(config: RiskGuardConfig, agentAddress: string) {
  const threshold = thresholdConfig(config);

  return AbiCoder.defaultAbiCoder().encode(
    ["address", "uint8", "uint256", "address"],
    [agentAddress, threshold.mode, threshold.value, zeroAddress],
  ) as `0x${string}`;
}

function isPaymasterOrBundlerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /paymaster|bundler|useroperation|aa95|out of gas|internal server error|status:?\s*500/i.test(
    message,
  );
}

async function connectUserPaidThirdwebSmartAccount(expectedSmartAccountAddress: string) {
  if (!thirdwebClient) {
    throw new Error("Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID before configuring RiskGuard.");
  }

  const personalWallet = EIP1193.fromProvider({
    provider: getEthereumProvider() as Parameters<typeof EIP1193.fromProvider>[0]["provider"],
    walletId: "app.subwallet",
  });
  const personalAccount = await personalWallet.connect({
    chain: somniaThirdwebChain,
    client: thirdwebClient,
  });
  const accountWallet = smartWallet({
    ...createThirdwebAccountAbstraction(),
    sponsorGas: false,
  });
  const account = await accountWallet.connect({
    client: thirdwebClient,
    personalAccount,
  });

  if (account.address.toLowerCase() !== expectedSmartAccountAddress.toLowerCase()) {
    throw new Error("User-paid smart account fallback returned a different smart account address.");
  }

  return account;
}

export async function connectRiskGuardSmartAccount() {
  if (!thirdwebClient) {
    throw new Error("Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID before configuring RiskGuard.");
  }

  const personalWallet = EIP1193.fromProvider({
    provider: getEthereumProvider() as Parameters<typeof EIP1193.fromProvider>[0]["provider"],
    walletId: "app.subwallet",
  });
  const personalAccount = await personalWallet.connect({
    chain: somniaThirdwebChain,
    client: thirdwebClient,
  });
  const accountWallet = smartWallet(createThirdwebAccountAbstraction());

  return accountWallet.connect({
    client: thirdwebClient,
    personalAccount,
  });
}

async function sendWithUserPaidFallback<T>(
  account: Account,
  send: (sender: Account) => Promise<T>,
) {
  return send(account).catch(async (error: unknown) => {
    if (!isPaymasterOrBundlerError(error)) {
      throw error;
    }

    const userPaidAccount = await connectUserPaidThirdwebSmartAccount(account.address);

    return send(userPaidAccount);
  });
}

export interface ConfigureRiskGuardPolicyInput {
  approvalStoreAddress: string;
  hookModuleAddress: string;
  agentAddress: string;
  config: RiskGuardConfig;
  account: Account;
}

export interface ConfigureRiskGuardPolicyResult {
  installTxHash: string;
  registerTxHash: string;
}

export async function configureRiskGuardPolicyWithThirdweb({
  account,
  agentAddress,
  approvalStoreAddress,
  config,
  hookModuleAddress,
}: ConfigureRiskGuardPolicyInput): Promise<ConfigureRiskGuardPolicyResult> {
  if (!thirdwebClient) {
    throw new Error("Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID before configuring RiskGuard.");
  }

  const smartAccountContract = getContract({
    address: account.address as HexAddress,
    chain: somniaThirdwebChain,
    client: thirdwebClient,
  });
  const approvalStoreContract = getContract({
    address: approvalStoreAddress as HexAddress,
    chain: somniaThirdwebChain,
    client: thirdwebClient,
  });
  const hookInitData = encodeHookInitData(config, agentAddress);
  const installHookTransaction = prepareContractCall({
    contract: smartAccountContract,
    method: "function installModule(uint256 moduleTypeId,address module,bytes initData)",
    gas: installHookGasLimit,
    params: [moduleTypeHook, hookModuleAddress as HexAddress, hookInitData],
  });
  const registerRouteTransaction = prepareContractCall({
    contract: approvalStoreContract,
    method: "function registerAgentAndHook(address agent,address hook)",
    gas: registerApprovalRouteGasLimit,
    params: [agentAddress as HexAddress, hookModuleAddress as HexAddress],
  });

  const installReceipt = await sendWithUserPaidFallback(account, (sender) =>
    sendAndConfirmTransaction({
      account: sender,
      transaction: installHookTransaction,
    }),
  );
  const registerReceipt = await sendWithUserPaidFallback(account, (sender) =>
    sendAndConfirmTransaction({
      account: sender,
      transaction: registerRouteTransaction,
    }),
  );

  return {
    installTxHash: installReceipt.transactionHash,
    registerTxHash: registerReceipt.transactionHash,
  };
}
