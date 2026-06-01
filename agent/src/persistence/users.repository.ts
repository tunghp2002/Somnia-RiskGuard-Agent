import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { isoDateTimeSchema } from "../utils/datetime.js";
import { JsonStore, type RepositoryStore } from "./json-store.js";

export const userSchema = z.object({
  userId: z.string().uuid(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  displayName: z.string().trim().min(1).max(64).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  telegramChatId: z.string().optional()
});

export const usersSchema = z.array(userSchema);

export type UserRecord = z.infer<typeof userSchema>;

interface UserProfileRow {
  user_id: string;
  wallet_address: string;
  display_name: string | null;
  telegram_chat_id: string | null;
  created_at: string;
  updated_at: string;
}

export class UsersRepository {
  private readonly store: RepositoryStore<UserRecord[]>;

  public constructor(dataDirectory?: string | URL, store?: RepositoryStore<UserRecord[]>) {
    this.store = store ?? new JsonStore({
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

  public async updateProfile(input: {
    walletAddress: string;
    displayName?: string | undefined;
  }): Promise<UserRecord> {
    const checksumAddress = getAddress(input.walletAddress);
    const displayName = input.displayName?.trim();
    const now = new Date().toISOString();
    let saved!: UserRecord;

    await this.store.update((users) => {
      const existing = users.find((user) => user.walletAddress === checksumAddress);

      saved = {
        ...(existing ?? {
          userId: randomUUID(),
          walletAddress: checksumAddress,
          createdAt: now
        }),
        ...(displayName ? { displayName } : {}),
        updatedAt: now
      };

      if (existing) {
        return users.map((user) => (user.userId === existing.userId ? saved : user));
      }

      return [...users, saved];
    });

    return saved;
  }
}

export class SupabaseUsersRepository extends UsersRepository {
  private readonly restUrl: string;
  private readonly headers: Record<string, string>;

  public constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly tableName = "user_profiles"
  ) {
    super();
    this.restUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${tableName}`;
    this.headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json"
    };
  }

  public override async list(): Promise<UserRecord[]> {
    const params = new URLSearchParams({
      select: "*",
      order: "updated_at.asc"
    });
    const rows = await this.request<UserProfileRow[]>(`?${params.toString()}`);
    return rows.map(fromProfileRow);
  }

  public override async findByWalletAddress(walletAddress: string): Promise<UserRecord | undefined> {
    const params = new URLSearchParams({
      select: "*",
      wallet_address: `eq.${getAddress(walletAddress)}`,
      limit: "1"
    });
    const rows = await this.request<UserProfileRow[]>(`?${params.toString()}`);
    return rows[0] ? fromProfileRow(rows[0]) : undefined;
  }

  public override async upsertMonitoredWallet(walletAddress: string): Promise<UserRecord> {
    const checksumAddress = getAddress(walletAddress);
    const existing = await this.findByWalletAddress(checksumAddress);
    const now = new Date().toISOString();
    const row = toProfileRow({
      ...(existing ?? {
        userId: randomUUID(),
        walletAddress: checksumAddress,
        createdAt: now
      }),
      updatedAt: now
    });

    return this.upsertRow(row);
  }

  public override async updateProfile(input: {
    walletAddress: string;
    displayName?: string | undefined;
  }): Promise<UserRecord> {
    const checksumAddress = getAddress(input.walletAddress);
    const existing = await this.findByWalletAddress(checksumAddress);
    const now = new Date().toISOString();
    const row = toProfileRow({
      ...(existing ?? {
        userId: randomUUID(),
        walletAddress: checksumAddress,
        createdAt: now
      }),
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      updatedAt: now
    });

    return this.upsertRow(row);
  }

  private async upsertRow(row: UserProfileRow): Promise<UserRecord> {
    const params = new URLSearchParams({
      on_conflict: "wallet_address"
    });
    const rows = await this.request<UserProfileRow[]>(`?${params.toString()}`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    });

    if (!rows[0]) {
      throw new Error("Supabase did not return the upserted user profile");
    }

    return fromProfileRow(rows[0]);
  }

  private async request<T>(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {}
  ): Promise<T> {
    const response = await fetch(`${this.restUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers,
        ...init.headers
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase user profile request failed (${response.status}): ${text}`);
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

function fromProfileRow(row: UserProfileRow): UserRecord {
  return userSchema.parse({
    userId: row.user_id,
    walletAddress: row.wallet_address,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.telegram_chat_id ? { telegramChatId: row.telegram_chat_id } : {})
  });
}

function toProfileRow(record: UserRecord): UserProfileRow {
  return {
    user_id: record.userId,
    wallet_address: record.walletAddress,
    display_name: record.displayName ?? null,
    telegram_chat_id: record.telegramChatId ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}
