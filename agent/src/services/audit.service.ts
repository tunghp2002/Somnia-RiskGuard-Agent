import type { Logger } from "pino";

import {
  AuditEventsRepository,
  type AuditEvent,
  type CreateAuditEventInput
} from "../persistence/audit-events.repository.js";

export class AuditService {
  public constructor(
    private readonly auditEvents: AuditEventsRepository,
    private readonly logger?: Pick<Logger, "info">
  ) {}

  public async record(input: CreateAuditEventInput): Promise<AuditEvent> {
    const event = await this.auditEvents.append(input);
    this.logger?.info({ auditEvent: event }, "audit event recorded");
    return event;
  }

  public list(): Promise<AuditEvent[]> {
    return this.auditEvents.list();
  }
}
