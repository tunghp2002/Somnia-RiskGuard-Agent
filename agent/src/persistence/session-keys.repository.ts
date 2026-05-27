import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";

import type { SessionKeyAction } from "../services/session-key-actions.js";

export interface SessionKeyRecord {
  sessionKeyId: string;
  walletAddress: string;
  smartAccountAddress?: string;
  action: SessionKeyAction;
  sessionKeyAddress: string;
  encryptedPrivateKey: string;
  encryptionIv: string;
  encryptionTag: string;
  status: "pending" | "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface UpsertSessionKeyInput {
  walletAddress: string;
  smartAccountAddress?: string;
  action: SessionKeyAction;
  sessionKeyAddress: string;
  encryptedPrivateKey: string;
  encryptionIv: string;
  encryptionTag: string;
  status: "pending" | "active";
}

export interface SessionKeysRepository {
  findForGrant(input: {
    walletAddress: string;
    smartAccountAddress?: string;
    action: SessionKeyAction;
  }): Promise<SessionKeyRecord | undefined>;
  findActiveBySmartAccount(
    smartAccountAddress: string,
    action: SessionKeyAction
  ): Promise<SessionKeyRecord | undefined>;
  upsert(input: UpsertSessionKeyInput): Promise<SessionKeyRecord>;
  markUsed(sessionKeyId: string, usedAt: string): Promise<void>;
}

interface SupabaseSessionKeyRow {
  session_key_id: string;
  wallet_address: string;
  smart_account_address: string | null;
  action: SessionKeyAction;
  session_key_address: string;
  encrypted_private_key: string;
  encryption_iv: string;
  encryption_tag: string;
  status: "pending" | "active" | "revoked";
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export class SupabaseSessionKeysRepository implements SessionKeysRepository {
  private readonly restUrl: string;

  public constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly tableName = "session_keys"
  ) {
    this.restUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${tableName}`;
    this.headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json"
    };
  }

  private readonly headers: Record<string, string>;

  public async findForGrant(input: {
    walletAddress: string;
    smartAccountAddress?: string;
    action: SessionKeyAction;
  }): Promise<SessionKeyRecord | undefined> {
    const walletAddress = getAddress(input.walletAddress);
    const smartAccountAddress = input.smartAccountAddress ? getAddress(input.smartAccountAddress) : undefined;

    if (smartAccountAddress) {
      const active = await this.findBySmartAccount(smartAccountAddress, input.action);
      if (active) {
        return active;
      }
    }

    const params = new URLSearchParams({
      select: "*",
      wallet_address: `eq.${walletAddress}`,
      action: `eq.${input.action}`,
      status: "neq.revoked",
      order: "updated_at.desc",
      limit: "1"
    });

    if (!smartAccountAddress) {
      params.set("smart_account_address", "is.null");
    }

    const data = await this.request<SupabaseSessionKeyRow[]>(`?${params.toString()}`);
    return data[0] ? fromRow(data[0]) : undefined;
  }

  public async findActiveBySmartAccount(
    smartAccountAddress: string,
    action: SessionKeyAction
  ): Promise<SessionKeyRecord | undefined> {
    const record = await this.findBySmartAccount(getAddress(smartAccountAddress), action);
    return record?.status === "active" ? record : undefined;
  }

  public async upsert(input: UpsertSessionKeyInput): Promise<SessionKeyRecord> {
    const walletAddress = getAddress(input.walletAddress);
    const smartAccountAddress = input.smartAccountAddress ? getAddress(input.smartAccountAddress) : undefined;
    const now = new Date().toISOString();
    const existing = smartAccountAddress
      ? await this.findBySmartAccount(smartAccountAddress, input.action)
      : await this.findForGrant({ walletAddress, action: input.action });
    const row = toRow({
      ...input,
      walletAddress,
      ...(smartAccountAddress ? { smartAccountAddress } : {}),
      sessionKeyId: existing?.sessionKeyId ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    const params = new URLSearchParams({
      on_conflict: "session_key_id"
    });
    const data = await this.request<SupabaseSessionKeyRow[]>(`?${params.toString()}`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    });

    if (!data[0]) {
      throw new Error("Supabase did not return the upserted session key");
    }

    return fromRow(data[0]);
  }

  public async markUsed(sessionKeyId: string, usedAt: string): Promise<void> {
    const params = new URLSearchParams({
      session_key_id: `eq.${sessionKeyId}`
    });
    await this.request<void>(`?${params.toString()}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ last_used_at: usedAt, updated_at: usedAt })
    });
  }

  private async findBySmartAccount(
    smartAccountAddress: string,
    action: SessionKeyAction
  ): Promise<SessionKeyRecord | undefined> {
    const params = new URLSearchParams({
      select: "*",
      smart_account_address: `eq.${smartAccountAddress}`,
      action: `eq.${action}`,
      status: "neq.revoked",
      order: "updated_at.desc",
      limit: "1"
    });
    const data = await this.request<SupabaseSessionKeyRow[]>(`?${params.toString()}`);
    return data[0] ? fromRow(data[0]) : undefined;
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
      throw new Error(`Supabase session key request failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

function fromRow(row: SupabaseSessionKeyRow): SessionKeyRecord {
  return {
    sessionKeyId: row.session_key_id,
    walletAddress: getAddress(row.wallet_address),
    ...(row.smart_account_address ? { smartAccountAddress: getAddress(row.smart_account_address) } : {}),
    action: row.action,
    sessionKeyAddress: getAddress(row.session_key_address),
    encryptedPrivateKey: row.encrypted_private_key,
    encryptionIv: row.encryption_iv,
    encryptionTag: row.encryption_tag,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {})
  };
}

function toRow(record: SessionKeyRecord): SupabaseSessionKeyRow {
  return {
    session_key_id: record.sessionKeyId,
    wallet_address: record.walletAddress,
    smart_account_address: record.smartAccountAddress ?? null,
    action: record.action,
    session_key_address: record.sessionKeyAddress,
    encrypted_private_key: record.encryptedPrivateKey,
    encryption_iv: record.encryptionIv,
    encryption_tag: record.encryptionTag,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    last_used_at: record.lastUsedAt ?? null
  };
}
