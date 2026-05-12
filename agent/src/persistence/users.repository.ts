import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { JsonStore } from "./json-store.js";

export const userSchema = z.object({
  userId: z.string().uuid(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  telegramChatId: z.string().optional()
});

export const usersSchema = z.array(userSchema);

export type UserRecord = z.infer<typeof userSchema>;

export class UsersRepository {
  private readonly store: JsonStore<UserRecord[]>;

  public constructor(dataDirectory?: string | URL) {
    this.store = new JsonStore({
      filename: "users.json",
      schema: usersSchema,
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<UserRecord[]> {
    return this.store.read();
  }

  public async findByWalletAddress(walletAddress: string): Promise<UserRecord | undefined> {
    const checksumAddress = getAddress(walletAddress);
    const users = await this.store.read();
    return users.find((user) => user.walletAddress === checksumAddress);
  }

  public async upsertMonitoredWallet(walletAddress: string): Promise<UserRecord> {
    const checksumAddress = getAddress(walletAddress);
    const now = new Date().toISOString();
    let saved!: UserRecord;

    await this.store.update((users) => {
      const existing = users.find((user) => user.walletAddress === checksumAddress);

      if (existing) {
        saved = { ...existing, updatedAt: now };
        return users.map((user) => (user.userId === existing.userId ? saved : user));
      }

      saved = {
        userId: randomUUID(),
        walletAddress: checksumAddress,
        createdAt: now,
        updatedAt: now
      };

      return [...users, saved];
    });

    return saved;
  }
}
