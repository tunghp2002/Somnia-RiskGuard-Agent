import { BrowserProvider, Contract } from "ethers";

import type { InheritancePlanStatus } from "@/lib/agent-api";

export interface BeneficiaryInput {
  address: string;
  sharePercent: number;
}

export interface InheritancePlanInput {
  beneficiaries: BeneficiaryInput[];
  heartbeatIntervalSeconds: number;
  gracePeriodSeconds: number;
  timelockPeriodSeconds: number;
}

const inheritanceRegistryAbi = [
  "function createPlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "function updatePlan((address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "function cancelPlan()"
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
};

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
  const registry = await getRegistryContract(registryAddress);
  const beneficiaries = toBeneficiaryArgs(input.beneficiaries);
  const protectedAssets = [{ token: "0x0000000000000000000000000000000000000000" }];
  const args = [
    beneficiaries,
    protectedAssets,
    BigInt(input.heartbeatIntervalSeconds),
    BigInt(input.gracePeriodSeconds),
    BigInt(input.timelockPeriodSeconds)
  ] as const;

  if (currentPlan?.active) {
    return waitForPlanTx(registry.updatePlan(...args));
  }

  return waitForPlanTx(registry.createPlan(...args));
}

export async function cancelInheritancePlan(registryAddress: string) {
  const registry = await getRegistryContract(registryAddress);

  return waitForPlanTx(registry.cancelPlan());
}
