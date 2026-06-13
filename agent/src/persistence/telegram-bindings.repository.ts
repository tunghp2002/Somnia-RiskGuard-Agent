import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { isoDateTimeSchema } from "../utils/datetime.js";
import { JsonStore, type RepositoryStore } from "./json-store.js";
import type { UserRecord, UsersRepository } from "./users.repository.js";

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
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
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

  public constructor(
    dataDirectory?: string | URL,
    store?: RepositoryStore<TelegramBindingRecord[]>,
    private readonly users?: UsersRepository
  ) {
    this.store = store ?? new JsonStore({
      filename: "telegram-bindings.json",
      schema: telegramBindingsSchema,
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<TelegramBindingRecord[]> {
    if (this.users) {
      return this.listFromUsers();
    }

    return this.store.read();
  }

  public async latestForWallet(walletAddress: string): Promise<TelegramBindingRecord | undefined> {
    if (this.users) {
      const user = await this.users.findByWalletAddress(walletAddress);
      return userToBinding(user);
    }

    const checksumAddress = getAddress(walletAddress);
    const bindings = await this.store.read();
    return bindings
      .filter((binding) => binding.walletAddress === checksumAddress)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  public async latestForSmartAccount(
    smartAccountAddress: string
  ): Promise<TelegramBindingRecord | undefined> {
    if (this.users) {
      const checksumAddress = getAddress(smartAccountAddress);
      const bindings = await this.listFromUsers();
      return bindings
        .filter((binding) => binding.smartAccountAddress === checksumAddress)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    }

    const checksumAddress = getAddress(smartAccountAddress);
    const bindings = await this.store.read();
    return bindings
      .filter((binding) => binding.smartAccountAddress === checksumAddress)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  public async attachSmartAccount(
    walletAddress: string,
    smartAccountAddress: string
  ): Promise<TelegramBindingRecord | undefined> {
    if (this.users) {
      const user = await this.users.attachTelegramSmartAccount(walletAddress, smartAccountAddress);
      return userToBinding(user);
    }

    const checksumWallet = getAddress(walletAddress);
    const checksumSmartAccount = getAddress(smartAccountAddress);
    const latest = await this.latestForWallet(checksumWallet);

    if (!latest) {
      return undefined;
    }

    const now = new Date().toISOString();
    let saved: TelegramBindingRecord | undefined;

    await this.store.update((bindings) =>
      bindings.map((binding) => {
        if (binding.telegramBindingId !== latest.telegramBindingId) {
          return binding;
        }

        saved = telegramBindingSchema.parse({
          ...binding,
          smartAccountAddress: checksumSmartAccount,
          updatedAt: now
        });

        return saved;
      })
    );

    return saved;
  }

  public async findByUserAndChat(
    userId: string,
    chatId: string
  ): Promise<TelegramBindingRecord | undefined> {
    if (this.users) {
      const bindings = await this.listFromUsers();
      return bindings.find((binding) => binding.userId === userId && binding.chatId === chatId);
    }

    const bindings = await this.store.read();
    return bindings.find((binding) => binding.userId === userId && binding.chatId === chatId);
  }

  public async latestForChat(
    chatId: string,
    telegramUserId?: string
  ): Promise<TelegramBindingRecord | undefined> {
    if (this.users) {
      const bindings = await this.listFromUsers();
      return bindings
        .filter((binding) => (
          binding.chatId === chatId &&
          (!telegramUserId || !binding.telegramUserId || binding.telegramUserId === telegramUserId)
        ))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    }

    const bindings = await this.store.read();
    return bindings
      .filter((binding) => (
        binding.chatId === chatId &&
        (!telegramUserId || !binding.telegramUserId || binding.telegramUserId === telegramUserId)
      ))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  public async deleteLatestForWallet(walletAddress: string): Promise<TelegramBindingRecord | undefined> {
    if (this.users) {
      const user = await this.users.clearTelegramBinding(walletAddress);
      return userToBinding(user);
    }

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
    if (this.users) {
      const user = await this.users.updateTelegramBinding(input);
      const binding = userToBinding(user);
      if (!binding) {
        throw new Error("Telegram binding wallet profile was not found");
      }
      return binding;
    }

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

  private async listFromUsers(): Promise<TelegramBindingRecord[]> {
    return (await this.users?.list() ?? [])
      .map(userToBinding)
      .filter((binding): binding is TelegramBindingRecord => Boolean(binding));
  }
}

function userToBinding(user: UserRecord | undefined): TelegramBindingRecord | undefined {
  if (!user?.telegramChatId) {
    return undefined;
  }

  return telegramBindingSchema.parse({
    telegramBindingId: user.userId,
    userId: user.userId,
    walletAddress: user.walletAddress,
    chatId: user.telegramChatId,
    telegramUserId: user.telegramUserId,
    telegramUsername: user.telegramUsername,
    telegramDisplayName: user.telegramDisplayName,
    smartAccountAddress: user.telegramSmartAccountAddress,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  });
}
