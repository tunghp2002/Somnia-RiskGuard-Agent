import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { JsonStore } from "./json-store.js";

export const alertStatusSchema = z.enum(["sent", "failed", "acknowledged"]);
export const alertSeveritySchema = z.enum(["low", "medium", "high", "critical"]);

export const alertRecordSchema = z.object({
  alertId: z.string().uuid(),
  userId: z.string().uuid(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  chatId: z.string().regex(/^-?\d+$/),
  riskSnapshotId: z.string().uuid(),
  status: alertStatusSchema,
  severity: alertSeveritySchema,
  score: z.number().int().min(0).max(100),
  explanation: z.string(),
  message: z.string(),
  telegramMessageId: z.string().optional(),
  failureReason: z.string().optional(),
  acknowledgedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const alertsSchema = z.array(alertRecordSchema);

export type AlertRecord = z.infer<typeof alertRecordSchema>;
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;

export interface CreateAlertInput {
  alertId?: string;
  userId: string;
  walletAddress: string;
  chatId: string;
  riskSnapshotId: string;
  status: AlertRecord["status"];
  severity: AlertSeverity;
  score: number;
  explanation: string;
  message: string;
  telegramMessageId?: string;
  failureReason?: string;
}

export class AlertsRepository {
  private readonly store: JsonStore<AlertRecord[]>;

  public constructor(dataDirectory?: string | URL) {
    this.store = new JsonStore({
      filename: "alerts.json",
      schema: alertsSchema,
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<AlertRecord[]> {
    return this.store.read();
  }

  public async findById(alertId: string): Promise<AlertRecord | undefined> {
    const alerts = await this.store.read();
    return alerts.find((alert) => alert.alertId === alertId);
  }

  public async append(input: CreateAlertInput): Promise<AlertRecord> {
    const now = new Date().toISOString();
    const alert = alertRecordSchema.parse({
      ...input,
      walletAddress: getAddress(input.walletAddress),
      alertId: input.alertId ?? randomUUID(),
      createdAt: now,
      updatedAt: now
    });

    await this.store.update((alerts) => [...alerts, alert]);
    return alert;
  }

  public async acknowledge(alertId: string): Promise<AlertRecord | undefined> {
    const now = new Date().toISOString();
    let saved: AlertRecord | undefined;

    await this.store.update((alerts) =>
      alerts.map((alert) => {
        if (alert.alertId !== alertId) {
          return alert;
        }

        saved = alertRecordSchema.parse({
          ...alert,
          status: "acknowledged",
          acknowledgedAt: now,
          updatedAt: now
        });
        return saved;
      })
    );

    return saved;
  }
}
