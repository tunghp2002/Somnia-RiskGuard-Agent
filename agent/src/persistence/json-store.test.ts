import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { AuditEventsRepository } from "./audit-events.repository.js";
import { JsonRepositoryError, JsonStore } from "./json-store.js";
import { UsersRepository } from "./users.repository.js";

let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-agent-"));
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

describe("JSON persistence repositories", () => {
  it("stores JSON through schema-validated helpers", async () => {
    const users = new UsersRepository(dataDirectory);
    const user = await users.upsertMonitoredWallet(
      "0x1111111111111111111111111111111111111111"
    );

    expect(user.walletAddress).toBe("0x1111111111111111111111111111111111111111");
    await expect(users.list()).resolves.toHaveLength(1);
  });

  it("fails safely when persisted JSON is malformed", async () => {
    await writeFile(join(dataDirectory, "items.json"), "{", "utf8");

    const store = new JsonStore({
      filename: "items.json",
      schema: z.array(z.string()),
      defaultValue: [],
      dataDirectory
    });

    await expect(store.read()).rejects.toBeInstanceOf(JsonRepositoryError);
  });

  it("appends audit events with timestamp, event type, status, and metadata", async () => {
    const repository = new AuditEventsRepository(dataDirectory);
    const event = await repository.append({
      eventType: "risk.score.updated",
      status: "succeeded",
      metadata: { walletAddress: "0x1111111111111111111111111111111111111111" }
    });

    expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.eventType).toBe("risk.score.updated");
    expect(event.status).toBe("succeeded");

    const raw = await readFile(join(dataDirectory, "audit-events.json"), "utf8");
    expect(raw).toContain("risk.score.updated");
  });

  it("redacts secret-looking audit metadata before persistence", async () => {
    const repository = new AuditEventsRepository(dataDirectory);

    await repository.append({
      eventType: "policy.checked",
      status: "denied",
      metadata: {
        privateKey: "0xsecret",
        nested: {
          apiToken: "token-value"
        }
      }
    });

    const raw = await readFile(join(dataDirectory, "audit-events.json"), "utf8");

    expect(raw).toContain("[REDACTED]");
    expect(raw).not.toContain("0xsecret");
    expect(raw).not.toContain("token-value");
  });

  it("serializes concurrent repository updates without losing records", async () => {
    const repository = new AuditEventsRepository(dataDirectory);

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repository.append({
          eventType: `event.${index}`,
          status: "succeeded"
        })
      )
    );

    await expect(repository.list()).resolves.toHaveLength(10);
  });
});
