import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { policyDecisionSchema } from "../policies/execution-policy.js";
import { JsonStore } from "./json-store.js";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => getAddress(value));

const moneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((value) => Number(value) >= 0, "Must be non-negative");

export const rewardSettingsSchema = z.object({
  rewardSettingsId: z.string().uuid(),
  walletAddress: addressSchema,
  autoClaimEnabled: z.boolean(),
  minRewardValueUsd: moneyStringSchema,
  maxClaimGasUsd: moneyStringSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const rewardFixtureSchema = z.object({
  rewardFixtureId: z.string().uuid(),
  walletAddress: addressSchema,
  protocol: z.string().min(1),
  rewardToken: z.string().min(1),
  valueUsd: moneyStringSchema,
  gasUsd: moneyStringSchema,
  target: addressSchema,
  calldataSummary: z.string().min(1),
  claimable: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const rewardClaimSchema = z.object({
  rewardClaimId: z.string().uuid(),
  walletAddress: addressSchema,
  rewardFixtureId: z.string().uuid().optional(),
  protocol: z.string().min(1),
  rewardToken: z.string().min(1),
  status: z.enum(["skipped", "attempted", "failed", "succeeded"]),
  reason: z.string().min(1).optional(),
  valueUsd: moneyStringSchema,
  gasUsd: moneyStringSchema,
  txHash: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
  policyDecision: policyDecisionSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const rewardClaimsDataSchema = z.object({
  settings: z.array(rewardSettingsSchema),
  fixtures: z.array(rewardFixtureSchema),
  claims: z.array(rewardClaimSchema)
});

export type RewardSettingsRecord = z.infer<typeof rewardSettingsSchema>;
export type RewardFixtureRecord = z.infer<typeof rewardFixtureSchema>;
export type RewardClaimRecord = z.infer<typeof rewardClaimSchema>;
type RewardClaimsData = z.infer<typeof rewardClaimsDataSchema>;

export interface SaveRewardSettingsInput {
  walletAddress: string;
  autoClaimEnabled: boolean;
  minRewardValueUsd: string;
  maxClaimGasUsd: string;
  now?: string;
}

export interface SaveRewardFixtureInput {
  walletAddress: string;
  protocol: string;
  rewardToken: string;
  valueUsd: string;
  gasUsd: string;
  target: string;
  calldataSummary: string;
  claimable?: boolean;
  now?: string;
}

export interface AppendRewardClaimInput {
  walletAddress: string;
  rewardFixtureId?: string;
  protocol: string;
  rewardToken: string;
  status: RewardClaimRecord["status"];
  reason?: string;
  valueUsd: string;
  gasUsd: string;
  txHash?: string;
  policyDecision?: RewardClaimRecord["policyDecision"];
  now?: string;
}

export class RewardClaimsRepository {
  private readonly store: JsonStore<RewardClaimsData>;

  public constructor(dataDirectory?: string | URL) {
    this.store = new JsonStore({
      filename: "reward-claims.json",
      schema: rewardClaimsDataSchema,
      defaultValue: {
        settings: [],
        fixtures: [],
        claims: []
      },
      dataDirectory
    });
  }

  public async listSettings(): Promise<RewardSettingsRecord[]> {
    return (await this.store.read()).settings;
  }

  public async findSettings(walletAddress: string): Promise<RewardSettingsRecord | undefined> {
    const checksumAddress = getAddress(walletAddress);
    const data = await this.store.read();
    return data.settings.find((settings) => settings.walletAddress === checksumAddress);
  }

  public async upsertSettings(input: SaveRewardSettingsInput): Promise<RewardSettingsRecord> {
    const walletAddress = getAddress(input.walletAddress);
    const now = input.now ?? new Date().toISOString();
    let saved!: RewardSettingsRecord;

    await this.store.update((data) => {
      const existing = data.settings.find((settings) => settings.walletAddress === walletAddress);
      saved = {
        rewardSettingsId: existing?.rewardSettingsId ?? randomUUID(),
        walletAddress,
        autoClaimEnabled: input.autoClaimEnabled,
        minRewardValueUsd: input.minRewardValueUsd,
        maxClaimGasUsd: input.maxClaimGasUsd,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

      return {
        ...data,
        settings: existing
          ? data.settings.map((settings) =>
              settings.rewardSettingsId === existing.rewardSettingsId ? saved : settings
            )
          : [...data.settings, saved]
      };
    });

    return saved;
  }

  public async upsertFixture(input: SaveRewardFixtureInput): Promise<RewardFixtureRecord> {
    const walletAddress = getAddress(input.walletAddress);
    const target = getAddress(input.target);
    const now = input.now ?? new Date().toISOString();
    let saved!: RewardFixtureRecord;

    await this.store.update((data) => {
      const existing = data.fixtures.find(
        (fixture) =>
          fixture.walletAddress === walletAddress &&
          fixture.protocol === input.protocol &&
          fixture.rewardToken === input.rewardToken &&
          fixture.target === target &&
          fixture.calldataSummary === input.calldataSummary
      );
      saved = {
        rewardFixtureId: existing?.rewardFixtureId ?? randomUUID(),
        walletAddress,
        protocol: input.protocol,
        rewardToken: input.rewardToken,
        valueUsd: input.valueUsd,
        gasUsd: input.gasUsd,
        target,
        calldataSummary: input.calldataSummary,
        claimable: input.claimable ?? true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

      return {
        ...data,
        fixtures: existing
          ? data.fixtures.map((fixture) =>
              fixture.rewardFixtureId === existing.rewardFixtureId ? saved : fixture
            )
          : [...data.fixtures, saved]
      };
    });

    return saved;
  }

  public async listClaimableFixtures(walletAddress: string): Promise<RewardFixtureRecord[]> {
    const checksumAddress = getAddress(walletAddress);
    const data = await this.store.read();
    return data.fixtures.filter(
      (fixture) => fixture.walletAddress === checksumAddress && fixture.claimable
    );
  }

  public async updateFixtureClaimable(
    rewardFixtureId: string,
    claimable: boolean,
    updatedAt = new Date().toISOString()
  ): Promise<RewardFixtureRecord | undefined> {
    let saved: RewardFixtureRecord | undefined;

    await this.store.update((data) => ({
      ...data,
      fixtures: data.fixtures.map((fixture) => {
        if (fixture.rewardFixtureId !== rewardFixtureId) {
          return fixture;
        }
        saved = {
          ...fixture,
          claimable,
          updatedAt
        };
        return saved;
      })
    }));

    return saved;
  }

  public async appendClaim(input: AppendRewardClaimInput): Promise<RewardClaimRecord> {
    const now = input.now ?? new Date().toISOString();
    const claim: RewardClaimRecord = {
      rewardClaimId: randomUUID(),
      walletAddress: getAddress(input.walletAddress),
      ...(input.rewardFixtureId ? { rewardFixtureId: input.rewardFixtureId } : {}),
      protocol: input.protocol,
      rewardToken: input.rewardToken,
      status: input.status,
      ...(input.reason ? { reason: input.reason } : {}),
      valueUsd: input.valueUsd,
      gasUsd: input.gasUsd,
      ...(input.txHash ? { txHash: input.txHash } : {}),
      ...(input.policyDecision ? { policyDecision: input.policyDecision } : {}),
      createdAt: now,
      updatedAt: now
    };

    await this.store.update((data) => ({
      ...data,
      claims: [...data.claims, claim]
    }));

    return claim;
  }

  public async updateClaim(
    rewardClaimId: string,
    input: Pick<AppendRewardClaimInput, "status" | "reason" | "txHash" | "now">
  ): Promise<RewardClaimRecord | undefined> {
    let saved: RewardClaimRecord | undefined;
    const now = input.now ?? new Date().toISOString();

    await this.store.update((data) => ({
      ...data,
      claims: data.claims.map((claim) => {
        if (claim.rewardClaimId !== rewardClaimId) {
          return claim;
        }
        saved = {
          ...claim,
          status: input.status,
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.txHash ? { txHash: input.txHash } : {}),
          updatedAt: now
        };
        return saved;
      })
    }));

    return saved;
  }

  public async listClaims(walletAddress?: string): Promise<RewardClaimRecord[]> {
    const data = await this.store.read();

    if (!walletAddress) {
      return data.claims;
    }

    const checksumAddress = getAddress(walletAddress);
    return data.claims.filter((claim) => claim.walletAddress === checksumAddress);
  }

  public async latestClaimForWallet(walletAddress: string): Promise<RewardClaimRecord | undefined> {
    const claims = await this.listClaims(walletAddress);
    return [...claims].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  }
}
