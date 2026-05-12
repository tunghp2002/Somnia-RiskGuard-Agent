import { randomUUID } from "node:crypto";

import { z } from "zod";

import { JsonStore } from "./json-store.js";

export const auditEventStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "skipped",
  "denied"
]);

export const auditEventSchema = z.object({
  auditEventId: z.string().uuid(),
  createdAt: z.string().datetime(),
  eventType: z.string().min(1),
  status: auditEventStatusSchema,
  metadata: z.record(z.unknown())
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

const sensitiveMetadataKeyPattern =
  /(privateKey|apiKey|token|secret|authorization|cookie|password)/i;

function sanitizeAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadata(item));
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
  private readonly store: JsonStore<AuditEvent[]>;

  public constructor(dataDirectory?: string | URL) {
    this.store = new JsonStore({
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

    await this.store.update((events) => [...events, event]);
    return event;
  }
}
