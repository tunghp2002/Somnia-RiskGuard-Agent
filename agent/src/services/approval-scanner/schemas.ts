import { z } from "zod";

import { MAX_ITEMS_PER_SCAN } from "./constants.js";

export const approvalListRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainIds: z.array(z.number().int().positive()).min(1)
});

export const approvalScanPrepareRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  approvals: z
    .array(
      z.object({
        chainId: z.number().int().positive(),
        token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        name: z.string().optional(),
        symbol: z.string().optional(),
        standard: z.enum(["erc20", "erc721", "erc1155"]).optional(),
        allowance: z.string().optional(),
        isUnlimited: z.boolean().optional()
      })
    )
    .min(1)
    .max(MAX_ITEMS_PER_SCAN)
});

export const approvalAnalyzePrepareRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainIds: z.array(z.number().int().positive()).min(1),
  mode: z.enum(["local", "onchain"]).optional()
});

const approvalEntrySchema = z.object({
  chainId: z.number().int().positive(),
  chainName: z.string(),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  symbol: z.string(),
  name: z.string(),
  standard: z.enum(["erc20", "erc721", "erc1155"]),
  spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  allowance: z.string(),
  isUnlimited: z.boolean(),
  explorerSpenderUrl: z.string()
});

export const approvalScanCacheRecordSchema = z.object({
  key: z.string(),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  chainName: z.string(),
  approvals: z.array(approvalEntrySchema),
  scannedFromBlock: z.number().int().nonnegative(),
  scannedToBlock: z.number().int().nonnegative(),
  targetFromBlock: z.number().int().nonnegative(),
  latestBlock: z.number().int().nonnegative(),
  partial: z.boolean(),
  lastError: z.string().optional(),
  updatedAt: z.string()
});

export type ApprovalScanCacheRecord = z.infer<typeof approvalScanCacheRecordSchema>;
