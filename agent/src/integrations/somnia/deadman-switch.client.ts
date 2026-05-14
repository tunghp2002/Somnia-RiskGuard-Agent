import { Contract, JsonRpcProvider } from "ethers";

import type { AgentConfig } from "../../config/env.js";
import type { HeartbeatContractState } from "../../persistence/heartbeats.repository.js";

const deadManSwitchAbi = [
  "function isExpired() view returns (bool)",
  "function isTimelockReady() view returns (bool)",
  "function executedAt() view returns (uint256)"
] as const;

export interface DeadManSwitchStateReader {
  readState(): Promise<HeartbeatContractState | undefined>;
}

export class EthersDeadManSwitchStateReader implements DeadManSwitchStateReader {
  private readonly provider: JsonRpcProvider;

  public constructor(private readonly config: AgentConfig) {
    this.provider = new JsonRpcProvider(config.somnia.rpcUrl, config.somnia.chainId);
  }

  public async readState(): Promise<HeartbeatContractState | undefined> {
    const contractAddress = this.config.somnia.deadManSwitchContractAddress;

    if (!contractAddress) {
      return undefined;
    }

    const contract = new Contract(contractAddress, deadManSwitchAbi, this.provider) as Contract & {
      isExpired(): Promise<boolean>;
      isTimelockReady(): Promise<boolean>;
      executedAt(): Promise<bigint>;
    };
    const [isExpired, timelockReady, executedAt] = await Promise.all([
      contract.isExpired(),
      contract.isTimelockReady(),
      contract.executedAt()
    ]);

    return {
      contractAddress,
      isExpired,
      timelockReady,
      executed: executedAt > 0n,
      checkedAt: new Date().toISOString()
    };
  }
}
