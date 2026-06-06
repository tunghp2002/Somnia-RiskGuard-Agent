import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getAddress } from "ethers";
import { z } from "zod";

const publicChainConfigPath = fileURLToPath(
  new URL("../../../config/public-chains.json", import.meta.url)
);

const optionalAddressSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid EVM address")
    .transform((value) => getAddress(value))
    .optional()
);

const publicChainSchema = z.object({
  name: z.string().trim().min(1),
  chainId: z.number().int().positive(),
  rpcUrl: z.string().url(),
  blockExplorerUrl: z.string().url(),
  blockscoutUrl: z.string().url().optional(),
  nativeCurrency: z.object({
    name: z.string().trim().min(1),
    symbol: z.string().trim().min(1),
    decimals: z.number().int().nonnegative()
  }),
  contracts: z.object({
    inheritanceRegistry: optionalAddressSchema,
    riskGuardApprovalStore: optionalAddressSchema,
    riskGuardHookModule: optionalAddressSchema,
    riskGuardValidatorModule: optionalAddressSchema,
    riskGuardModularAccountFactory: optionalAddressSchema,
    riskGuardDefaultValidator: optionalAddressSchema,
    approvalRiskScanner: optionalAddressSchema
  }).default({})
});

const scanChainSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  chainId: z.number().int().positive(),
  rpcUrl: z.string().url(),
  blockExplorerUrl: z.string().url(),
  explorerApiBaseUrl: z.string().url(),
  explorerApiUrlTemplate: z.string().trim().min(1),
  explorerApiSelector: z.string().trim().min(1),
  explorerPageUrlTemplate: z.string().trim().min(1),
  nativeCurrency: z.object({
    name: z.string().trim().min(1),
    symbol: z.string().trim().min(1),
    decimals: z.number().int().nonnegative()
  }),
  scanSupported: z.boolean().default(true),
  priority: z.number().int().nonnegative().default(0)
});

const publicChainConfigSchema = z.object({
  defaultChain: z.string().trim().min(1),
  chains: z.record(z.string().trim().min(1), publicChainSchema),
  scanChains: z.array(scanChainSchema).default([])
});

export type PublicChain = z.infer<typeof publicChainSchema>;
export type ScanChain = z.infer<typeof scanChainSchema>;

export interface PublicChainMetadata extends PublicChain {
  key: string;
}

export class PublicChainConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicChainConfigError";
  }
}

function loadPublicChainConfig(): z.infer<typeof publicChainConfigSchema> {
  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(publicChainConfigPath, "utf8"));
  } catch (error) {
    throw new PublicChainConfigError(
      `Public chain config could not be loaded from config/public-chains.json: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }

  const parsed = publicChainConfigSchema.safeParse(raw);

  if (!parsed.success) {
    throw new PublicChainConfigError(
      `Public chain config is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }

  return parsed.data;
}

export function loadPublicChainMetadata(chainKey?: string): PublicChainMetadata {
  const config = loadPublicChainConfig();
  const key = chainKey ?? config.defaultChain;
  const chain = config.chains[key];

  if (!chain) {
    throw new PublicChainConfigError(`Public chain config has no chain named ${key}`);
  }

  return {
    key,
    ...chain
  };
}

export function loadScanChains(): ScanChain[] {
  const config = loadPublicChainConfig();
  return [...config.scanChains]
    .filter((chain) => chain.scanSupported)
    .sort((a, b) => a.priority - b.priority);
}
