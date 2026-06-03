import { BrowserProvider, Contract } from "ethers";
import { getContract, prepareContractCall, prepareTransaction, sendAndConfirmTransaction } from "thirdweb";
import { EIP1193, smartWallet, type Account } from "thirdweb/wallets";

import {
  createThirdwebAccountAbstraction,
  riskGuardAccountSalt,
  somniaThirdwebChain,
  thirdwebClient
} from "@/lib/thirdweb-client";

import type { InheritancePlanStatus } from "@/lib/agent-api";

export interface BeneficiaryInput {
  address: string;
  sharePercent: number;
}

export interface InheritancePlanInput {
  smartAccountAddress: string;
  beneficiaries: BeneficiaryInput[];
  protectedAssets: string[];
  heartbeatIntervalSeconds: number;
  gracePeriodSeconds: number;
  timelockPeriodSeconds: number;
}

const inheritanceRegistryAbi = [
  "function createPlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "function updatePlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "function cancelPlan()"
];

// `createPlan` / `updatePlan` now schedules Somnia reactivity on-chain, which
// materially increases execution cost under ERC-4337 simulation.
const planWriteGasLimit = 5000_000_000n;
const cancelPlanGasLimit = 1_000_000n;

type RegistryContract = Contract & {
  createPlan(
    beneficiaries: Array<{ addr: string; shareBps: bigint }>,
    protectedAssets: Array<{ token: string }>,
    heartbeatInterval: bigint,
    gracePeriod: bigint,
    timelockPeriod: bigint
  ): Promise<{ wait: () => Promise<unknown>; hash: string }>;
  updatePlan(
    beneficiaries: Array<{ addr: string; shareBps: bigint }>,
    protectedAssets: Array<{ token: string }>,
    heartbeatInterval: bigint,
    gracePeriod: bigint,
    timelockPeriod: bigint
  ): Promise<{ wait: () => Promise<unknown>; hash: string }>;
  cancelPlan(): Promise<{ wait: () => Promise<unknown>; hash: string }>;
};

export interface SmartAccountCandidate {
  address: string;
  kind: "contract" | "eoa";
}

function getEthereumProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No browser wallet detected");
  }

  return window.ethereum;
}

function toBeneficiaryArgs(beneficiaries: BeneficiaryInput[]) {
  return beneficiaries.map((beneficiary) => ({
    addr: beneficiary.address.trim(),
    shareBps: BigInt(Math.round(beneficiary.sharePercent * 100))
  }));
}

async function getRegistryContract(registryAddress: string) {
  const provider = new BrowserProvider(getEthereumProvider());
  const signer = await provider.getSigner();

  return new Contract(registryAddress, inheritanceRegistryAbi, signer) as RegistryContract;
}

async function getConnectedSignerAddress() {
  const provider = new BrowserProvider(getEthereumProvider());
  const signer = await provider.getSigner();
  const signerAddress = await signer.getAddress();
  const signerCode = await provider.getCode(signerAddress);

  return { provider, signerAddress, signerCode };
}

export async function discoverConnectedSmartAccounts(): Promise<SmartAccountCandidate[]> {
  const provider = new BrowserProvider(getEthereumProvider());
  let accounts = await getEthereumProvider().request<string[]>({
    method: "eth_accounts"
  });

  if (accounts.length === 0) {
    accounts = await getEthereumProvider().request<string[]>({
      method: "eth_requestAccounts"
    });
  }
  const candidates = await Promise.all(
    accounts.map(async (address) => ({
      address,
      kind: (await provider.getCode(address)) === "0x" ? "eoa" as const : "contract" as const
    }))
  );

  return candidates.filter((candidate) => candidate.kind === "contract");
}

async function waitForPlanTx(txPromise: Promise<{ wait: () => Promise<unknown>; hash: string }>) {
  const tx = await txPromise;
  await tx.wait();

  return tx.hash;
}

async function ensureThirdwebSmartAccountDeployed(account: Account) {
  if (!thirdwebClient) {
    throw new Error("Thirdweb client is not configured.");
  }

  const provider = new BrowserProvider(getEthereumProvider());
  const code = await provider.getCode(account.address);

  if (code !== "0x") {
    return;
  }

  const deployTransaction = prepareTransaction({
    chain: somniaThirdwebChain,
    client: thirdwebClient,
    to: account.address,
    value: 0n
  });

  await sendAndConfirmTransaction({
    account,
    transaction: deployTransaction
  });
}

function isPaymasterOrBundlerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /paymaster|bundler|useroperation|aa95|out of gas|internal server error|status:?\s*500/i.test(message);
}

async function connectUserPaidThirdwebSmartAccount(expectedSmartAccountAddress: string) {
  if (!thirdwebClient) {
    throw new Error("Thirdweb client is not configured.");
  }

  const personalWallet = EIP1193.fromProvider({
    provider: getEthereumProvider() as Parameters<typeof EIP1193.fromProvider>[0]["provider"],
    walletId: "app.subwallet"
  });
  const personalAccount = await personalWallet.connect({
    chain: somniaThirdwebChain,
    client: thirdwebClient
  });
  const accountWallet = smartWallet({
    ...createThirdwebAccountAbstraction({
      overrides: { accountSalt: riskGuardAccountSalt }
    }),
    sponsorGas: false
  });
  const account = await accountWallet.connect({
    client: thirdwebClient,
    personalAccount
  });

  if (account.address.toLowerCase() !== expectedSmartAccountAddress.toLowerCase()) {
    throw new Error("User-paid smart account fallback returned a different smart account address.");
  }

  return account;
}

export async function saveInheritancePlan(
  registryAddress: string,
  input: InheritancePlanInput,
  currentPlan?: InheritancePlanStatus | null
) {
  const { signerAddress, signerCode } = await getConnectedSignerAddress();
  const smartAccountAddress = input.smartAccountAddress.trim();

  if (signerCode === "0x") {
    throw new Error("Connect a smart account before creating an inheritance plan.");
  }

  if (signerAddress.toLowerCase() !== smartAccountAddress.toLowerCase()) {
    throw new Error("Select the smart account as the active wallet before saving this plan.");
  }

  const registry = await getRegistryContract(registryAddress);
  const beneficiaries = toBeneficiaryArgs(input.beneficiaries);
  const protectedAssets = input.protectedAssets.map((token) => ({ token }));
  const args = [
    beneficiaries,
    protectedAssets,
    BigInt(input.heartbeatIntervalSeconds),
    BigInt(input.gracePeriodSeconds),
    BigInt(input.timelockPeriodSeconds)
  ] as const;

  const planTxHash = currentPlan?.active
    ? await waitForPlanTx(registry.updatePlan(...args))
    : await waitForPlanTx(registry.createPlan(...args));

  return planTxHash;
}

export async function saveInheritancePlanWithThirdweb(
  registryAddress: string,
  input: InheritancePlanInput,
  account: Account,
  currentPlan?: InheritancePlanStatus | null
) {
  if (!thirdwebClient) {
    throw new Error("Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID before creating a smart-account plan.");
  }

  const smartAccountAddress = input.smartAccountAddress.trim();
  if (account.address.toLowerCase() !== smartAccountAddress.toLowerCase()) {
    throw new Error("Select the active Thirdweb smart account before saving this plan.");
  }

  await ensureThirdwebSmartAccountDeployed(account);
  const registry = getContract({
    address: registryAddress,
    chain: somniaThirdwebChain,
    client: thirdwebClient
  });
  const beneficiaries = toBeneficiaryArgs(input.beneficiaries);
  const protectedAssets = input.protectedAssets.map((token) => ({ token }));
  const method = currentPlan?.active
    ? "function updatePlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)"
    : "function createPlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)";
  const planTransaction = prepareContractCall({
    contract: registry,
    method,
    gas: planWriteGasLimit,
    params: [
      beneficiaries,
      protectedAssets,
      BigInt(input.heartbeatIntervalSeconds),
      BigInt(input.gracePeriodSeconds),
      BigInt(input.timelockPeriodSeconds)
    ]
  });
  const planReceipt = await sendAndConfirmTransaction({
    account,
    transaction: planTransaction
  }).catch(async (error: unknown) => {
    if (!isPaymasterOrBundlerError(error)) {
      throw error;
    }

    const userPaidAccount = await connectUserPaidThirdwebSmartAccount(smartAccountAddress);
    await ensureThirdwebSmartAccountDeployed(userPaidAccount);

    return sendAndConfirmTransaction({
      account: userPaidAccount,
      transaction: planTransaction
    });
  });
  return planReceipt.transactionHash;
}

export async function cancelInheritancePlan(registryAddress: string, expectedSmartAccount?: string) {
  const { signerAddress, signerCode } = await getConnectedSignerAddress();

  if (signerCode === "0x") {
    throw new Error("Connect the smart account before cancelling this inheritance plan.");
  }

  if (expectedSmartAccount && signerAddress.toLowerCase() !== expectedSmartAccount.toLowerCase()) {
    throw new Error("Select the plan smart account as the active wallet before cancelling this plan.");
  }

  const registry = await getRegistryContract(registryAddress);

  return waitForPlanTx(registry.cancelPlan());
}

export async function cancelInheritancePlanWithThirdweb(registryAddress: string, account: Account) {
  if (!thirdwebClient) {
    throw new Error("Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID before cancelling a smart-account plan.");
  }

  const registry = getContract({
    address: registryAddress,
    chain: somniaThirdwebChain,
    client: thirdwebClient
  });
  const transaction = prepareContractCall({
    contract: registry,
    method: "function cancelPlan()",
    gas: cancelPlanGasLimit,
    params: []
  });
  const receipt = await sendAndConfirmTransaction({
    account,
    transaction
  }).catch(async (error: unknown) => {
    if (!isPaymasterOrBundlerError(error)) {
      throw error;
    }

    const userPaidAccount = await connectUserPaidThirdwebSmartAccount(account.address);

    return sendAndConfirmTransaction({
      account: userPaidAccount,
      transaction
    });
  });

  return receipt.transactionHash;
}
