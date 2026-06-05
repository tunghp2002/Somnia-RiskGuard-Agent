import { describe, expect, it } from "vitest";

import {
  ApprovalScannerService,
  ApprovalScannerServiceError
} from "./approval-scanner.service.js";
import { createTestConfig } from "../test-helpers/env.js";
import type { ScanChain } from "../config/public-chain.js";

const chains: ScanChain[] = [
  {
    id: "ethereum",
    name: "Ethereum",
    chainId: 1,
    rpcUrl: "https://eth.example",
    blockExplorerUrl: "https://etherscan.io/",
    explorerApiBaseUrl: "https://api.etherscan.io/api",
    explorerApiUrlTemplate: "https://api.etherscan.io/api?address={spender}",
    explorerApiSelector: "result.0.ContractName",
    explorerPageUrlTemplate: "https://etherscan.io/address/{spender}",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    scanSupported: true,
    priority: 1
  },
  {
    id: "somnia-testnet",
    name: "Somnia Testnet",
    chainId: 50312,
    rpcUrl: "https://dream-rpc.somnia.network",
    blockExplorerUrl: "https://shannon-explorer.somnia.network/",
    explorerApiBaseUrl: "https://shannon-explorer.somnia.network/api",
    explorerApiUrlTemplate: "https://shannon-explorer.somnia.network/api?address={spender}",
    explorerApiSelector: "result.0.ContractName",
    explorerPageUrlTemplate: "https://shannon-explorer.somnia.network/address/{spender}",
    nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
    scanSupported: true,
    priority: 0
  }
];

describe("approval scanner service", () => {
  it("returns supported chains sorted by priority (Somnia first)", () => {
    const service = new ApprovalScannerService(createTestConfig(), chains);
    const supported = service.getSupportedChains();

    expect(supported.map((chain) => chain.chainId)).toEqual([50312, 1]);
    expect(supported[0]?.name).toBe("Somnia Testnet");
    expect(supported[0]?.nativeCurrencySymbol).toBe("STT");
  });

  it("skips unknown chain ids without performing network reads", async () => {
    const service = new ApprovalScannerService(createTestConfig(), chains);
    const result = await service.discoverApprovals(
      "0x1111111111111111111111111111111111111111",
      [999999]
    );
    expect(result).toEqual([]);
  });

  it("rejects prepareScan when the scanner contract is not configured", async () => {
    const service = new ApprovalScannerService(createTestConfig(), chains);
    await expect(
      service.prepareScan([
        {
          chainId: 50312,
          token: "0x2222222222222222222222222222222222222222",
          spender: "0x3333333333333333333333333333333333333333"
        }
      ])
    ).rejects.toBeInstanceOf(ApprovalScannerServiceError);
  });
});
