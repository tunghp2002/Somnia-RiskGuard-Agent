import { BrowserProvider, Contract, parseEther } from "ethers";
import { getContract, prepareContractCall, sendAndConfirmTransaction } from "thirdweb";
import type { Account } from "thirdweb/wallets";

import type { InheritancePlanStatus } from "@/lib/agent-api";
import { somniaThirdwebChain, thirdwebClient } from "@/lib/thirdweb-client";

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
  agentBudgetSTT?: string;
}

const inheritanceRegistryAbi = [
  "function createPlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "function updatePlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "function cancelPlan()",
  "function fundAgentBudget(address smartAccount) payable"
];

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
  fundAgentBudget(
    smartAccount: string,
    overrides: { value: bigint }
  ): Promise<{ wait: () => Promise<unknown>; hash: string }>;
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
  const agentBudget = Number(input.agentBudgetSTT ?? 0);

  if (Number.isFinite(agentBudget) && agentBudget > 0) {
    await waitForPlanTx(registry.fundAgentBudget(smartAccountAddress, {
      value: parseEther(input.agentBudgetSTT ?? "0")
    }));
  }

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
  });
  const agentBudget = Number(input.agentBudgetSTT ?? 0);

  if (Number.isFinite(agentBudget) && agentBudget > 0) {
    const budgetTransaction = prepareContractCall({
      contract: registry,
      method: "function fundAgentBudget(address smartAccount) payable",
      params: [smartAccountAddress],
      value: parseEther(input.agentBudgetSTT ?? "0")
    });
    await sendAndConfirmTransaction({
      account,
      transaction: budgetTransaction
    });
  }

  return planReceipt.transactionHash;
}

export async function cancelInheritancePlan(registryAddress: string) {
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
    params: []
  });
  const receipt = await sendAndConfirmTransaction({
    account,
    transaction
  });

  return receipt.transactionHash;
}
