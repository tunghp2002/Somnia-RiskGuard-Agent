import { Interface, getAddress, parseUnits } from "ethers";
import {
  getContract,
  prepareTransaction,
  prepareContractCall,
  readContract,
  sendBatchTransaction,
  sendAndConfirmTransaction,
  waitForReceipt,
} from "thirdweb";
import { EIP1193, smartWallet, type Account } from "thirdweb/wallets";

import {
  createThirdwebAccountAbstraction,
  riskGuardAccountSalt,
  somniaThirdwebChain,
  thirdwebClient,
} from "@/lib/thirdweb-client";

import type { RiskGuardConfig } from "@/types";

const moduleTypeValidator = 1n;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const installValidatorGasLimit = 2_500_000n;
const setValidatorConfigGasLimit = 500_000n;
const registerApprovalRouteGasLimit = 500_000n;
const approvalSessionKeyFundingWei = parseUnits("0.03", 18);
type HexAddress = `0x${string}`;
type SmartAccountValidator = "default" | "riskguard";
const riskGuardValidatorInterface = new Interface([
  "error PendingApprovalRequired(address smartAccount, bytes32 txHash, address signer, bytes riskContext)",
]);

function getEthereumProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No browser wallet detected.");
  }

  return window.ethereum;
}

function thresholdConfig(config: RiskGuardConfig) {
  if (!config.enabled) {
    return { mode: 0, value: 0n };
  }

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

function isPendingApprovalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const candidates = message.match(/0x[a-fA-F0-9]{8,}/g) ?? [];

  return candidates.some((candidate) => {
    try {
      return riskGuardValidatorInterface.parseError(candidate)?.name === "PendingApprovalRequired";
    } catch {
      return false;
    }
  });
}

export async function connectUserPaidThirdwebSmartAccount(
  expectedSmartAccountAddress: string,
  validator: SmartAccountValidator = "riskguard",
) {
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
    ...createThirdwebAccountAbstraction({
      validator,
      overrides: { accountSalt: riskGuardAccountSalt },
    }),
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
  const accountWallet = smartWallet(createThirdwebAccountAbstraction({
    overrides: { accountSalt: riskGuardAccountSalt },
  }));

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
  const accountWallet = smartWallet(createThirdwebAccountAbstraction({
    validator: "default",
    overrides: { accountSalt: riskGuardAccountSalt },
  }));

  return accountWallet.connect({
    client: thirdwebClient,
    personalAccount,
  });
}

async function sendWithUserPaidFallback<T>(
  account: Account,
  send: (sender: Account) => Promise<T>,
  validator: SmartAccountValidator = "riskguard",
) {
  return send(account).catch(async (error: unknown) => {
    if (!isPaymasterOrBundlerError(error)) {
      throw error;
    }

    const userPaidAccount = await connectUserPaidThirdwebSmartAccount(account.address, validator);

    return send(userPaidAccount);
  });
}

async function sendBatchAndConfirm(account: Account, transactions: Parameters<typeof sendBatchTransaction>[0]["transactions"]) {
  const waitOptions = await sendBatchTransaction({
    account,
    transactions,
  });

  return waitForReceipt(waitOptions);
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
  const isValidatorInitialized = await readContract({
    contract: guardModuleContract,
    method: "function isInitialized(address smartAccount) view returns (bool)",
    params: [account.address as HexAddress],
  }).catch(() => false);
  const isGuardEnabled = isValidatorInitialized
    ? await readContract({
        contract: guardModuleContract,
        method: "function configs(address smartAccount) view returns (bool initialized,bool enabled,uint8 mode,uint256 thresholdValue,address balanceToken)",
        params: [account.address as HexAddress],
      }).then((configResult) => Boolean(configResult[1])).catch(() => false)
    : false;

  if (!config.enabled && !isValidatorInitialized) {
    return {
      configTxHash: "",
      installTxHash: "",
      registerTxHash: "",
    };
  }

  if (config.enabled && isGuardEnabled) {
    const registeredAgent = await readContract({
      contract: approvalStoreContract,
      method: "function registeredAgent(address smartAccount) view returns (address)",
      params: [account.address as HexAddress],
    }).catch(() => zeroAddress);

    if (getAddress(registeredAgent) === getAddress(zeroAddress)) {
      throw new Error(
        "This smart account already has RiskGuard enabled, but no approval agent is registered. Disable or recover it with a default-validator account before configuring again.",
      );
    }
  }

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

  let registerTxHash = "";
  let configTxHash = "";
  let installTxHash = "";

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
    const fundApprovalSessionTransaction = prepareTransaction({
      chain: somniaThirdwebChain,
      client: thirdwebClient,
      to: agentAddress as HexAddress,
      value: approvalSessionKeyFundingWei,
    });
    const setupTransactions = [
      ...(isValidatorInstalled ? [] : [installValidatorTransaction]),
      registerRouteTransaction,
      fundApprovalSessionTransaction,
      setConfigTransaction,
    ];
    const setupReceipt = await sendWithUserPaidFallback(account, (sender) =>
      sendBatchAndConfirm(sender, setupTransactions),
      "default",
    ).catch((error: unknown) => {
      if (isPendingApprovalError(error)) {
        throw new Error(
          "RiskGuard blocked its own setup transaction. The approval route must be registered before enabling the policy, or the account must be recovered from an older partial setup.",
        );
      }
      throw error;
    });
    registerTxHash = setupReceipt.transactionHash;
    configTxHash = setupReceipt.transactionHash;
    installTxHash = isValidatorInstalled ? "" : setupReceipt.transactionHash;
  } else {
    const configReceipt = await sendWithUserPaidFallback(account, (sender) =>
      sendAndConfirmTransaction({
        account: sender,
        transaction: setConfigTransaction,
      }),
      "default",
    ).catch((error: unknown) => {
      if (isPendingApprovalError(error)) {
        throw new Error(
          "RiskGuard blocked its own setup transaction. The approval route must be registered before enabling the policy, or the account must be recovered from an older partial setup.",
        );
      }
      throw error;
    });
    configTxHash = configReceipt.transactionHash;
  }

  return {
    configTxHash,
    installTxHash,
    registerTxHash,
  };
}
