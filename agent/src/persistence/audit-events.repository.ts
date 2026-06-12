import { randomUUID } from "node:crypto";

import { z } from "zod";

import { isoDateTimeSchema } from "../utils/datetime.js";
import { JsonStore, type RepositoryStore } from "./json-store.js";

export const auditEventStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "skipped",
  "denied"
]);

export const auditEventSchema = z.object({
  auditEventId: z.string().uuid(),
  createdAt: isoDateTimeSchema,
  eventType: z.string().min(1),
  status: auditEventStatusSchema,
  metadata: z.record(z.string(), z.unknown())
});

export const auditEventsSchema = z.array(auditEventSchema);

export type AuditEventStatus = z.infer<typeof auditEventStatusSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;

export interface CreateAuditEventInput {
  eventType: string;
  status: AuditEventStatus;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

const maxAuditEvents = 500;
const sensitiveMetadataKeyPattern =
  /(private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|authorization|cookie|password|credential)/i;

function sanitizeAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadata(item));
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveMetadataKeyPattern.test(key)
        ? "[REDACTED]"
        : sanitizeAuditMetadata(item)
    ])
  );
}

export class AuditEventsRepository {
  private readonly store: RepositoryStore<AuditEvent[]>;

  public constructor(dataDirectory?: string | URL, store?: RepositoryStore<AuditEvent[]>) {
    this.store = store ?? new JsonStore({
      filename: "audit-events.json",
      schema: auditEventsSchema,
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<AuditEvent[]> {
    return this.store.read();
  }

  public async append(input: CreateAuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      auditEventId: randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
      eventType: input.eventType,
      status: input.status,
      metadata: sanitizeAuditMetadata(input.metadata ?? {}) as Record<string, unknown>
    };

    await this.store.update((events) =>
      [...events, event]
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .slice(-maxAuditEvents)
    );
    return event;
  }
}
