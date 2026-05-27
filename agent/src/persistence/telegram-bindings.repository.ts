import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { JsonStore, type RepositoryStore } from "./json-store.js";

export const telegramBindingSchema = z.object({
  telegramBindingId: z.string().uuid(),
  userId: z.string().uuid(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  chatId: z.string().regex(/^-?\d+$/),
  telegramUserId: z.string().regex(/^\d+$/).optional(),
  telegramUsername: z.string().min(1).max(64).optional(),
  telegramDisplayName: z.string().min(1).max(128).optional(),
  smartAccountAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value))
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const telegramBindingsSchema = z.array(telegramBindingSchema);

export type TelegramBindingRecord = z.infer<typeof telegramBindingSchema>;

export interface UpsertTelegramBindingInput {
  userId: string;
  walletAddress: string;
  chatId: string;
  telegramUserId?: string;
  telegramUsername?: string;
  telegramDisplayName?: string;
  smartAccountAddress?: string;
}

export class TelegramBindingsRepository {
  private readonly store: RepositoryStore<TelegramBindingRecord[]>;

  public constructor(dataDirectory?: string | URL, store?: RepositoryStore<TelegramBindingRecord[]>) {
    this.store = store ?? new JsonStore({
      filename: "telegram-bindings.json",
      schema: telegramBindingsSchema,
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<TelegramBindingRecord[]> {
    return this.store.read();
  }

  public async latestForWallet(walletAddress: string): Promise<TelegramBindingRecord | undefined> {
    const checksumAddress = getAddress(walletAddress);
    const bindings = await this.store.read();
    return bindings
      .filter((binding) => binding.walletAddress === checksumAddress)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  public async findByUserAndChat(
    userId: string,
    chatId: string
  ): Promise<TelegramBindingRecord | undefined> {
    const bindings = await this.store.read();
    return bindings.find((binding) => binding.userId === userId && binding.chatId === chatId);
  }

  public async latestForChat(
    chatId: string,
    telegramUserId?: string
  ): Promise<TelegramBindingRecord | undefined> {
    const bindings = await this.store.read();
    return bindings
      .filter((binding) => (
        binding.chatId === chatId &&
        (!telegramUserId || !binding.telegramUserId || binding.telegramUserId === telegramUserId)
      ))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  public async deleteLatestForWallet(walletAddress: string): Promise<TelegramBindingRecord | undefined> {
    const checksumAddress = getAddress(walletAddress);
    const latest = await this.latestForWallet(checksumAddress);

    if (!latest) {
      return undefined;
    }

    await this.store.update((bindings) =>
      bindings.filter((binding) => binding.telegramBindingId !== latest.telegramBindingId)
    );

    return latest;
  }

  public async upsert(input: UpsertTelegramBindingInput): Promise<TelegramBindingRecord> {
    const checksumAddress = getAddress(input.walletAddress);
    const now = new Date().toISOString();
    let saved!: TelegramBindingRecord;

    await this.store.update((bindings) => {
      const existing = bindings.find((binding) => binding.userId === input.userId);

      if (existing) {
        saved = telegramBindingSchema.parse({
          ...existing,
          walletAddress: checksumAddress,
          chatId: input.chatId,
          telegramUserId: input.telegramUserId,
          telegramUsername: input.telegramUsername,
          telegramDisplayName: input.telegramDisplayName,
          smartAccountAddress: input.smartAccountAddress,
          updatedAt: now
        });
        return bindings.map((binding) =>
          binding.telegramBindingId === existing.telegramBindingId ? saved : binding
        );
      }

      saved = telegramBindingSchema.parse({
        telegramBindingId: randomUUID(),
        userId: input.userId,
        walletAddress: checksumAddress,
        chatId: input.chatId,
        telegramUserId: input.telegramUserId,
        telegramUsername: input.telegramUsername,
        telegramDisplayName: input.telegramDisplayName,
        smartAccountAddress: input.smartAccountAddress,
        createdAt: now,
        updatedAt: now
      });

      return [...bindings, saved];
    });

    return saved;
  }
}
