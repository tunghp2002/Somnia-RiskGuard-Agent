import { z } from "zod";

import type { RepositoryStore } from "./json-store.js";

export interface SupabaseJsonStoreOptions<T> {
  filename: string;
  schema: z.ZodType<T>;
  defaultValue: T;
  supabaseUrl: string;
  serviceRoleKey: string;
  tableName?: string;
}

interface AppRecordRow {
  collection: string;
  data: unknown;
  created_at?: string;
  updated_at?: string;
}

export class SupabaseJsonStore<T> implements RepositoryStore<T> {
  private static readonly writeQueues = new Map<string, Promise<unknown>>();

  private readonly collection: string;
  private readonly restUrl: string;
  private readonly headers: Record<string, string>;

  public constructor(private readonly options: SupabaseJsonStoreOptions<T>) {
    this.collection = options.filename.replace(/\.json$/i, "");
    this.restUrl = `${options.supabaseUrl.replace(/\/$/, "")}/rest/v1/${options.tableName ?? "app_records"}`;
    this.headers = {
      apikey: options.serviceRoleKey,
      Authorization: `Bearer ${options.serviceRoleKey}`,
      "Content-Type": "application/json"
    };
  }

  public async read(): Promise<T> {
    const params = new URLSearchParams({
      select: "data",
      collection: `eq.${this.collection}`,
      limit: "1"
    });
    const rows = await this.request<AppRecordRow[]>(`?${params.toString()}`);
    const value = rows[0]?.data ?? this.options.defaultValue;
    return this.options.schema.parse(value);
  }

  public async write(value: T): Promise<void> {
    const parsed = this.options.schema.parse(value);
    const now = new Date().toISOString();
    const params = new URLSearchParams({
      on_conflict: "collection"
    });
    await this.request<AppRecordRow[]>(`?${params.toString()}`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        collection: this.collection,
        data: parsed,
        updated_at: now
      })
    });
  }

  public async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      const current = await this.read();
      const next = await mutator(current);
      await this.write(next);
      return next;
    });
  }

  private async request<TResponse>(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {}
  ): Promise<TResponse> {
    const response = await fetch(`${this.restUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers,
        ...init.headers
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase app record request failed (${response.status}): ${text}`);
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as TResponse;
    }

    return (await response.json()) as TResponse;
  }

  private async runExclusive<R>(operation: () => Promise<R>): Promise<R> {
    const previous = SupabaseJsonStore.writeQueues.get(this.collection) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    SupabaseJsonStore.writeQueues.set(
      this.collection,
      next.finally(() => {
        if (SupabaseJsonStore.writeQueues.get(this.collection) === next) {
          SupabaseJsonStore.writeQueues.delete(this.collection);
        }
      })
    );
    return next;
  }
}
