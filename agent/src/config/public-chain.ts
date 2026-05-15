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
  nativeCurrency: z.object({
    name: z.string().trim().min(1),
    symbol: z.string().trim().min(1),
    decimals: z.number().int().nonnegative()
  }),
  contracts: z.object({
    deadManSwitch: optionalAddressSchema
  }).default({})
});

const publicChainConfigSchema = z.object({
  defaultChain: z.string().trim().min(1),
  chains: z.record(z.string().trim().min(1), publicChainSchema)
});

export type PublicChain = z.infer<typeof publicChainSchema>;

export interface PublicChainMetadata extends PublicChain {
  key: string;
}

export class PublicChainConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicChainConfigError";
  }
}

export function loadPublicChainMetadata(chainKey?: string): PublicChainMetadata {
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

  const key = chainKey ?? parsed.data.defaultChain;
  const chain = parsed.data.chains[key];

  if (!chain) {
    throw new PublicChainConfigError(`Public chain config has no chain named ${key}`);
  }

  return {
    key,
    ...chain
  };
}
