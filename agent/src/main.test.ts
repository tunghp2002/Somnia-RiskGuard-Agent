import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigValidationError } from "./config/env.js";
import { createSomniaAgentKitClient } from "./integrations/somnia/somnia-agent-kit.client.js";
import type { TelegramClient } from "./integrations/telegram/telegram.client.js";
import { main } from "./main.js";
import { runCli } from "./main.js";
import { startAgentRuntime } from "./main.js";
import { createTestConfig } from "./test-helpers/env.js";

class FakePollingTelegramClient implements TelegramClient {
  public pollingStarted = false;
  public stopped = false;

  public health() {
    return { ok: true, enabled: true };
  }

  public async sendMessage() {
    return {};
  }

  public startPolling() {
    this.pollingStarted = true;
    return {
      stop: () => {
        this.stopped = true;
      }
    };
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("agent startup", () => {
  it("validates config before running startup hooks", async () => {
    const startRuntime = vi.fn();

    await expect(
      main({
        env: {},
        loadDotenv: false,
        startRuntime
      })
    ).rejects.toBeInstanceOf(ConfigValidationError);

    expect(startRuntime).not.toHaveBeenCalled();
  });

  it("prints safe diagnostics for CLI config validation failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCli({ env: {}, loadDotenv: false });

    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0]?.[0]).toContain("THIRDWEB_SECRET_KEY");
    expect(consoleError.mock.calls[0]?.[0]).not.toContain("SOMNIA_RPC_URL");
    expect(consoleError.mock.calls[0]?.[0]).not.toContain("ConfigValidationError");
    expect(consoleError.mock.calls[0]?.[0]).not.toContain("at ");
    expect(process.exitCode).toBe(1);
  });

  it("starts API health and Telegram polling in the default runtime", async () => {
    const telegramClient = new FakePollingTelegramClient();
    const config = createTestConfig();
    const somniaClient = createSomniaAgentKitClient(config, {
      callTool: vi.fn(),
      health: vi.fn().mockResolvedValue({ ok: true })
    });
    const runtime = await startAgentRuntime(createTestConfig(), {
      apiPort: 0,
      telegramClient,
      somniaClient
    });

    try {
      const response = await fetch(`http://127.0.0.1:${runtime.apiPort}/api/health`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.data.telegram.ok).toBe(true);
      expect(telegramClient.pollingStarted).toBe(true);
    } finally {
      await runtime.stop();
    }

    expect(telegramClient.stopped).toBe(true);
  });
});
