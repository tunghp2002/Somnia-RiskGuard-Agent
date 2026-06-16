import type { HeartbeatReminderResult, HeartbeatService } from "../services/heartbeat/index.js";

export class HeartbeatJob {
  public constructor(private readonly heartbeats: HeartbeatService) {}

  public runOnce(): Promise<HeartbeatReminderResult[]> {
    return this.heartbeats.evaluateReminders();
  }
}
