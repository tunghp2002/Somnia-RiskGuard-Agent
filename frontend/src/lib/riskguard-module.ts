import { parseUnits } from "ethers";
import {
  getContract,
  prepareContractCall,
  readContract,
  sendAndConfirmTransaction,
} from "thirdweb";
import { EIP1193, smartWallet, type Account } from "thirdweb/wallets";

import {
  createThirdwebAccountAbstraction,
  somniaThirdwebChain,
  thirdwebClient,
} from "@/lib/thirdweb-client";

import type { RiskGuardConfig } from "@/features/dashboard/types";

const moduleTypeValidator = 1n;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const installValidatorGasLimit = 2_500_000n;
const setValidatorConfigGasLimit = 500_000n;
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

function isPaymasterOrBundlerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /paymaster|bundler|useroperation|aa36|aa95|out of gas|internal server error|status:?\s*500/i.test(
    message,
  );
}

export async function connectUserPaidThirdwebSmartAccount(expectedSmartAccountAddress: string) {
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

export async function connectRiskGuardBootstrapSmartAccount() {
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
  const accountWallet = smartWallet(createThirdwebAccountAbstraction({ validator: "default" }));

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
  guardModuleAddress: string;
  agentAddress?: string;
  config: RiskGuardConfig;
  account: Account;
}

export interface ConfigureRiskGuardPolicyResult {
  configTxHash: string;
  installTxHash: string;
  registerTxHash: string;
}

export async function configureRiskGuardPolicyWithThirdweb({
  account,
  agentAddress,
  approvalStoreAddress,
  config,
  guardModuleAddress,
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
  const guardModuleContract = getContract({
    address: guardModuleAddress as HexAddress,
    chain: somniaThirdwebChain,
    client: thirdwebClient,
  });
  const threshold = thresholdConfig(config);
  const isValidatorInstalled = await readContract({
    contract: smartAccountContract,
    method: "function isModuleInstalled(uint256 moduleTypeId,address module,bytes additionalContext) view returns (bool)",
    params: [moduleTypeValidator, guardModuleAddress as HexAddress, "0x"],
  }).catch(() => false);
  const installValidatorTransaction = prepareContractCall({
    contract: smartAccountContract,
    method: "function installModule(uint256 moduleTypeId,address module,bytes initData)",
    gas: installValidatorGasLimit,
    params: [moduleTypeValidator, guardModuleAddress as HexAddress, "0x"],
  });
  const setConfigTransaction = prepareContractCall({
    contract: guardModuleContract,
    method: "function setConfig(bool enabled,uint8 mode,uint256 thresholdValue,address balanceToken)",
    gas: setValidatorConfigGasLimit,
    params: [config.enabled, threshold.mode, threshold.value, zeroAddress],
  });

  const installReceipt = !config.enabled || isValidatorInstalled
    ? { transactionHash: "" }
    : await sendWithUserPaidFallback(account, (sender) =>
        sendAndConfirmTransaction({
          account: sender,
          transaction: installValidatorTransaction,
        }),
      );
  const configReceipt = await sendWithUserPaidFallback(account, (sender) =>
    sendAndConfirmTransaction({
      account: sender,
      transaction: setConfigTransaction,
    }),
  );
  let registerTxHash = "";

  if (config.enabled) {
    if (!agentAddress) {
      throw new Error("RiskGuard approval session key is required before enabling the guard.");
    }

    const registerRouteTransaction = prepareContractCall({
      contract: approvalStoreContract,
      method: "function registerAgentAndHook(address agent,address hook)",
      gas: registerApprovalRouteGasLimit,
      params: [agentAddress as HexAddress, guardModuleAddress as HexAddress],
    });
    const registerReceipt = await sendWithUserPaidFallback(account, (sender) =>
      sendAndConfirmTransaction({
        account: sender,
        transaction: registerRouteTransaction,
      }),
    );
    registerTxHash = registerReceipt.transactionHash;
  }

  return {
    configTxHash: configReceipt.transactionHash,
    installTxHash: installReceipt.transactionHash,
    registerTxHash,
  };
}
