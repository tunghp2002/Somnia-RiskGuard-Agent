import { BrowserProvider, Contract, getAddress } from "ethers";
import {
  getContract,
  prepareContractCall,
  readContract,
} from "thirdweb";

import { sendRiskGuardedSmartTransaction } from "@/lib/riskguard-smart-account";
import {
  somniaThirdwebChain,
  thirdwebClient
} from "@/lib/thirdweb-client";

import type { InheritancePlanStatus } from "@/lib/agent-api";
import type { Account } from "thirdweb/wallets";

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

export interface RiskGuardedInheritanceOptions {
  riskGuardValidatorAddress?: string;
  walletAddress?: string;
}

const inheritanceRegistryAbi = [
  "function AGENT_SUBCOMMITTEE_SIZE() view returns (uint256)",
  "function agentBudgetOf(address smartAccount) view returns (uint256)",
  "function agentPlatform() view returns (address)",
  "function agentRewardPerCall() view returns (uint256)",
  "function createPlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "function updatePlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "function cancelPlan()",
  "function fundAgentBudget(address smartAccount) payable"
];
const smartAccountRolesAbi = [
  "function grantRoles(address user,uint256 roles)",
  "function hasAnyRole(address user,uint256 roles) view returns (bool)"
];
const agentRequesterAbi = [
  "function getRequestDeposit() view returns (uint256)"
];

// `createPlan` / `updatePlan` schedules Somnia reactivity on-chain, so keep a
// generous explicit UserOp call gas limit without asking the bundler to chase it.
const planWriteGasLimit = 5_000_000n;
const cancelPlanGasLimit = 1_000_000n;
const smartAccountAdminRole = 1n;
const inheritanceDistributionAgentCalls = 1n;
const zeroAddress = "0x0000000000000000000000000000000000000000";

type RegistryContract = Contract & {
  AGENT_SUBCOMMITTEE_SIZE(): Promise<bigint>;
  agentBudgetOf(smartAccount: string): Promise<bigint>;
  agentPlatform(): Promise<string>;
  agentRewardPerCall(): Promise<bigint>;
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

type SmartAccountRolesContract = Contract & {
  grantRoles(user: string, roles: bigint): Promise<{ wait: () => Promise<unknown>; hash: string }>;
  hasAnyRole(user: string, roles: bigint): Promise<boolean>;
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

async function getBrowserSigner() {
  const provider = new BrowserProvider(getEthereumProvider());
  return provider.getSigner();
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

async function ensureRegistryExecutorRole(
  smartAccountAddress: string,
  registryAddress: string
) {
  const signer = await getBrowserSigner();
  const smartAccountRoles = new Contract(
    smartAccountAddress,
    smartAccountRolesAbi,
    signer
  ) as SmartAccountRolesContract;
  const hasRegistryRole = await smartAccountRoles
    .hasAnyRole(registryAddress, smartAccountAdminRole)
    .catch(() => false);

  if (hasRegistryRole) {
    return;
  }

  await waitForPlanTx(smartAccountRoles.grantRoles(registryAddress, smartAccountAdminRole));
}

async function fundInheritanceAgentBudget(
  registryAddress: string,
  smartAccountAddress: string,
  topUp: bigint
) {
  if (topUp <= 0n) {
    return;
  }

  const signer = await getBrowserSigner();
  const registry = new Contract(registryAddress, inheritanceRegistryAbi, signer) as RegistryContract;
  await waitForPlanTx(registry.fundAgentBudget(smartAccountAddress, { value: topUp }));
}

async function quoteInheritanceAgentTopUpWithEthers(
  registryAddress: string,
  smartAccountAddress: string
) {
  const provider = new BrowserProvider(getEthereumProvider());
  const registry = new Contract(registryAddress, inheritanceRegistryAbi, provider) as RegistryContract;
  const agentPlatform = getAddress(await registry.agentPlatform());

  if (agentPlatform === getAddress(zeroAddress)) {
    throw new Error("Inheritance Registry agent platform is not configured.");
  }

  const platform = new Contract(agentPlatform, agentRequesterAbi, provider);
  const [requestDeposit, rewardPerCall, subcommitteeSize, currentBudget] = await Promise.all([
    platform.getFunction("getRequestDeposit").staticCall(),
    registry.agentRewardPerCall(),
    registry.AGENT_SUBCOMMITTEE_SIZE(),
    registry.agentBudgetOf(smartAccountAddress)
  ]) as [bigint, bigint, bigint, bigint];
  const requiredBudget =
    (requestDeposit + (rewardPerCall * subcommitteeSize)) * inheritanceDistributionAgentCalls;

  return currentBudget < requiredBudget ? requiredBudget - currentBudget : 0n;
}

async function quoteInheritanceAgentTopUpWithThirdweb(
  registry: ReturnType<typeof getContract>,
  smartAccountAddress: string
) {
  const agentPlatform = getAddress(await readContract({
    contract: registry,
    method: "function agentPlatform() view returns (address)",
    params: []
  }));

  if (agentPlatform === getAddress(zeroAddress)) {
    throw new Error("Inheritance Registry agent platform is not configured.");
  }

  const platform = getContract({
    address: agentPlatform,
    chain: somniaThirdwebChain,
    client: thirdwebClient!
  });
  const [requestDeposit, rewardPerCall, subcommitteeSize, currentBudget] = await Promise.all([
    readContract({
      contract: platform,
      method: "function getRequestDeposit() view returns (uint256)",
      params: []
    }),
    readContract({
      contract: registry,
      method: "function agentRewardPerCall() view returns (uint256)",
      params: []
    }),
    readContract({
      contract: registry,
      method: "function AGENT_SUBCOMMITTEE_SIZE() view returns (uint256)",
      params: []
    }),
    readContract({
      contract: registry,
      method: "function agentBudgetOf(address smartAccount) view returns (uint256)",
      params: [smartAccountAddress]
    })
  ]);
  const requiredBudget =
    (requestDeposit + (rewardPerCall * subcommitteeSize)) * inheritanceDistributionAgentCalls;

  return currentBudget < requiredBudget ? requiredBudget - currentBudget : 0n;
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

  await ensureRegistryExecutorRole(smartAccountAddress, registryAddress);

  const topUp = await quoteInheritanceAgentTopUpWithEthers(registryAddress, smartAccountAddress);
  await fundInheritanceAgentBudget(registryAddress, smartAccountAddress, topUp);

  const planTxHash = currentPlan?.active
    ? await waitForPlanTx(registry.updatePlan(...args))
    : await waitForPlanTx(registry.createPlan(...args));

  return planTxHash;
}

export async function saveInheritancePlanWithThirdweb(
  registryAddress: string,
  input: InheritancePlanInput,
  account: Account,
  currentPlan?: InheritancePlanStatus | null,
  options: RiskGuardedInheritanceOptions = {}
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
  await ensureRegistryExecutorRole(smartAccountAddress, registryAddress);

  const topUp = await quoteInheritanceAgentTopUpWithThirdweb(registry, smartAccountAddress);
  await fundInheritanceAgentBudget(registryAddress, smartAccountAddress, topUp);

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
  return sendRiskGuardedSmartTransaction({
    account,
    ...(options.riskGuardValidatorAddress ? { riskGuardValidatorAddress: options.riskGuardValidatorAddress } : {}),
    transaction: planTransaction,
    ...(options.walletAddress ? { walletAddress: options.walletAddress } : {})
  });
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

export async function cancelInheritancePlanWithThirdweb(
  registryAddress: string,
  account: Account,
  options: RiskGuardedInheritanceOptions = {}
) {
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
  return sendRiskGuardedSmartTransaction({
    account,
    ...(options.riskGuardValidatorAddress ? { riskGuardValidatorAddress: options.riskGuardValidatorAddress } : {}),
    transaction,
    ...(options.walletAddress ? { walletAddress: options.walletAddress } : {})
  });
}
