import { Contract, JsonRpcProvider, getAddress } from "ethers";

import type { PublicChainMetadata } from "../../config/public-chain.js";

const inheritanceRegistryAbi = [
  "function getPlan(address smartAccount) view returns ((address smartAccount,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod,uint256 lastHeartbeatAt,uint256 createdAt,uint256 updatedAt,uint256 executedAt,uint8 state),(address addr,uint256 shareBps)[],(address token)[])",
  "function nextDeadlineAt(address smartAccount) view returns (uint256)",
  "function graceEndsAt(address smartAccount) view returns (uint256)",
  "function timelockEndsAt(address smartAccount) view returns (uint256)"
] as const;

export interface InheritancePlanBeneficiary {
  address: string;
  shareBps: number;
}

export interface InheritancePlanStatus {
  registryAddress: string;
  smartAccount: string;
  state: "none" | "active" | "cancelled" | "executed";
  active: boolean;
  heartbeatIntervalSeconds: number;
  gracePeriodSeconds: number;
  timelockPeriodSeconds: number;
  lastHeartbeatAt?: string;
  nextDeadlineAt?: string;
  graceEndsAt?: string;
  timelockEndsAt?: string;
  executedAt?: string;
  beneficiaries: InheritancePlanBeneficiary[];
  protectedAssets: Array<{
    token: string;
    kind: "native" | "erc20";
  }>;
  createdAt?: string;
  updatedAt?: string;
}

type RegistryContract = Contract & {
  getPlan(smartAccount: string): Promise<[
    {
      smartAccount: string;
      heartbeatInterval: bigint;
      gracePeriod: bigint;
      timelockPeriod: bigint;
      lastHeartbeatAt: bigint;
      createdAt: bigint;
      updatedAt: bigint;
      executedAt: bigint;
      state: bigint;
    },
    Array<{ addr: string; shareBps: bigint }>,
    Array<{ token: string }>
  ]>;
  nextDeadlineAt(smartAccount: string): Promise<bigint>;
  graceEndsAt(smartAccount: string): Promise<bigint>;
  timelockEndsAt(smartAccount: string): Promise<bigint>;
};

function isoFromSeconds(seconds: bigint): string | undefined {
  if (seconds === 0n) {
    return undefined;
  }

  return new Date(Number(seconds) * 1000).toISOString();
}

function stateName(state: bigint): InheritancePlanStatus["state"] {
  if (state === 1n) return "active";
  if (state === 2n) return "cancelled";
  if (state === 3n) return "executed";
  return "none";
}

function optionalDate(key: string, seconds: bigint): Record<string, string> {
  const value = isoFromSeconds(seconds);

  return value ? { [key]: value } : {};
}

export class InheritanceRegistryClient {
  private readonly provider: JsonRpcProvider;

  public constructor(private readonly publicChain: PublicChainMetadata) {
    this.provider = new JsonRpcProvider(publicChain.rpcUrl, publicChain.chainId);
  }

  public async getPlan(smartAccountInput: string): Promise<InheritancePlanStatus | null> {
    const registryAddress = this.publicChain.contracts.inheritanceRegistry;

    if (!registryAddress) {
      return null;
    }

    const smartAccount = getAddress(smartAccountInput);
    const contract = new Contract(
      registryAddress,
      inheritanceRegistryAbi,
      this.provider
    ) as RegistryContract;
    const [[plan, beneficiaries, protectedAssets], nextDeadline, graceEnd, timelockEnd] = await Promise.all([
      contract.getPlan(smartAccount),
      contract.nextDeadlineAt(smartAccount),
      contract.graceEndsAt(smartAccount),
      contract.timelockEndsAt(smartAccount)
    ]);
    const state = stateName(BigInt(plan.state));

    return {
      registryAddress,
      smartAccount,
      state,
      active: state === "active",
      heartbeatIntervalSeconds: Number(plan.heartbeatInterval),
      gracePeriodSeconds: Number(plan.gracePeriod),
      timelockPeriodSeconds: Number(plan.timelockPeriod),
      beneficiaries: beneficiaries.map((beneficiary) => ({
        address: getAddress(beneficiary.addr),
        shareBps: Number(beneficiary.shareBps)
      })),
      protectedAssets: protectedAssets.map((asset) => ({
        token: getAddress(asset.token),
        kind: asset.token === "0x0000000000000000000000000000000000000000" ? "native" : "erc20"
      })),
      ...optionalDate("lastHeartbeatAt", plan.lastHeartbeatAt),
      ...optionalDate("nextDeadlineAt", nextDeadline),
      ...optionalDate("graceEndsAt", graceEnd),
      ...optionalDate("timelockEndsAt", timelockEnd),
      ...optionalDate("executedAt", plan.executedAt),
      ...optionalDate("createdAt", plan.createdAt),
      ...optionalDate("updatedAt", plan.updatedAt)
    };
  }
}
