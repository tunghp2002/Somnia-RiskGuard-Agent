import { describe, expect, it } from "vitest";

import { createTestConfig } from "../test-helpers/env.js";
import { createLogger, loggerRedactPaths } from "./logger.js";

describe("structured logger", () => {
  it("configures secret-safe pino redaction paths", () => {
    expect(loggerRedactPaths).toContain("thirdweb.secretKey");
    expect(loggerRedactPaths).toContain("supabase.serviceRoleKey");
    expect(loggerRedactPaths).toContain("supabase.sessionKeyEncryptionKey");
    expect(loggerRedactPaths).toContain("llm.groq.apiKey");
    expect(loggerRedactPaths).toContain("telegram.botToken");
  });

  it("creates a pino logger at the configured level", () => {
    const logger = createLogger(createTestConfig());

    expect(logger.level).toBe("info");
  });
});
