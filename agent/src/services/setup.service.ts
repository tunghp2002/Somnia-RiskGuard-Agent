import { getAddress, verifyMessage } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../config/env.js";
import type { SessionKeyService } from "./session-key/index.js";
import type { SessionKeyAction } from "./session-key/actions.js";
import type { AuditService } from "./audit.service.js";
import {
  signedWalletProofFields,
  validateSignedWalletProof
} from "./signed-wallet-proof.js";
import { UsersRepository } from "../persistence/users.repository.js";

export const setupWalletRequestSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .refine(
        (value) => {
          try {
            getAddress(value);
            return true;
          } catch {
            return false;
          }
        },
        { message: "Must be a valid checksum or lowercase EVM address" }
      )
      .transform((value) => getAddress(value)),
    signature: z.string().min(1),
    message: z.string().min(1)
  })
  .strict()
  .superRefine((input, context) => {
    let recoveredAddress: string;

    try {
      recoveredAddress = verifyMessage(input.message, input.signature);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Signature must be a valid signed-message proof",
        path: ["signature"]
      });
      return;
    }

    if (getAddress(recoveredAddress) !== input.walletAddress) {
      context.addIssue({
        code: "custom",
        message: "Signature must recover the submitted wallet address",
        path: ["signature"]
      });
    }
  });

export type SetupWalletRequest = z.infer<typeof setupWalletRequestSchema>;

export const userProfileUpdateRequestSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    displayName: z.preprocess(
      (value) => {
        if (typeof value !== "string") {
          return undefined;
        }
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
      },
      z.string().max(64).optional()
    ),
    ...signedWalletProofFields
  })
  .strict()
  .superRefine((input, context) => validateSignedWalletProof(input, context, "profile.update"));

export type UserProfileUpdateRequest = z.infer<typeof userProfileUpdateRequestSchema>;

export class SetupService {
  public constructor(
    private readonly users: UsersRepository,
    private readonly config: AgentConfig,
    private readonly audit?: AuditService,
    private readonly sessionKeys?: SessionKeyService
  ) {}

  public async registerMonitoredWallet(input: SetupWalletRequest) {
    const parsed = setupWalletRequestSchema.parse(input);
    const user = await this.users.upsertMonitoredWallet(parsed.walletAddress);

    await this.audit?.record({
      eventType: "setup.wallet.registered",
      status: "succeeded",
      metadata: {
        userId: user.userId,
        walletAddress: user.walletAddress
      }
    });

    return user;
  }

  public async getUserProfile(walletAddress: string) {
    return this.users.findByWalletAddress(walletAddress);
  }

  public async updateUserProfile(input: UserProfileUpdateRequest) {
    const parsed = userProfileUpdateRequestSchema.parse(input);
    const user = await this.users.updateProfile(parsed);

    await this.audit?.record({
      eventType: "profile.updated",
      status: "succeeded",
      metadata: {
        userId: user.userId,
        walletAddress: user.walletAddress
      }
    });

    return user;
  }

  public async getReadiness() {
    const users = await this.users.list();

    return {
      monitoredWallet: {
        ready: users.length > 0,
        walletAddress: users.at(-1)?.walletAddress
      },
      sessionKey: {
        ready: Boolean(this.sessionKeys?.ready()),
        chainId: this.config.somnia.chainId
      },
      configuration: {
        telegramEnabled: this.config.telegram.enabled,
        autoClaimEnabled: this.config.rewards.autoClaimEnabled
      }
    };
  }

  public ensureSessionKeyAction(input: {
    walletAddress: string;
    smartAccountAddress?: string;
    action: SessionKeyAction;
  }) {
    if (!this.sessionKeys) {
      throw new Error("Session key service is not configured");
    }

    return this.sessionKeys.ensurePermission(input);
  }
}
