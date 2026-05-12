import { z } from "zod";

import { JsonStore } from "./json-store.js";

export const actionNonceSchema = z.object({
  actionNonce: z.string().min(1),
  userId: z.string().uuid(),
  actionType: z.string().min(1),
  expiresAt: z.string().datetime(),
  consumedAt: z.string().datetime().optional()
});

export type ActionNonceRecord = z.infer<typeof actionNonceSchema>;

export class ActionNoncesRepository {
  private readonly store: JsonStore<ActionNonceRecord[]>;

  public constructor(dataDirectory?: string | URL) {
    this.store = new JsonStore({
      filename: "action-nonces.json",
      schema: z.array(actionNonceSchema),
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<ActionNonceRecord[]> {
    return this.store.read();
  }
}
