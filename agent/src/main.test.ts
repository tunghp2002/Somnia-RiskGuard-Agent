import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigValidationError } from "./config/env.js";
import { main } from "./main.js";
import { runCli } from "./main.js";

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
    expect(consoleError.mock.calls[0]?.[0]).toContain("SOMNIA_RPC_URL");
    expect(consoleError.mock.calls[0]?.[0]).not.toContain("ConfigValidationError");
    expect(consoleError.mock.calls[0]?.[0]).not.toContain("at ");
    expect(process.exitCode).toBe(1);
  });
});
