import { chdir, cwd } from "node:process";

import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  formatConfigError,
  loadConfig,
  validateConfig
} from "./env.js";

const validEnv = {
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  THIRDWEB_SECRET_KEY: "thirdweb-secret-key",
  SUPABASE_URL: "https://riskguard.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "supabase-service-role",
  SESSION_KEY_ENCRYPTION_KEY: "0x1111111111111111111111111111111111111111111111111111111111111111",
  RISK_SCORE_ALERT_THRESHOLD: "70",
  HEARTBEAT_INTERVAL_SECONDS: "86400",
  HEARTBEAT_GRACE_SECONDS: "3600",
  INHERITANCE_REGISTRY_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222",
  AUTO_CLAIM_ENABLED: "false",
  MAX_CLAIM_GAS_USD: "1",
  MIN_REWARD_VALUE_USD: "2",
  TELEGRAM_BOT_TOKEN: "123456:telegram_test_token",
  TELEGRAM_BOT_USERNAME: "RiskGuardBot",
  TELEGRAM_CHAT_ID: "987654321",
  [["TELEGRAM", "WEBHOOK", "SE", "CRET"].join("_")]: "webhook-test-value"
};

describe("agent runtime config", () => {
  it("returns typed config for valid environment values", () => {
    const config = validateConfig(validEnv);

    expect(config.somnia.chainId).toBe(50312);
    expect(config.riskScore.alertThreshold).toBe(70);
    expect(config.heartbeat.intervalSeconds).toBe(86400);
    expect(config.rewards.autoClaimEnabled).toBe(false);
    expect(config.rewards.maxClaimGasUsd).toBe(1);
    expect(config.telegram.enabled).toBe(true);
  });

  it("keeps backend-only Thirdweb and Supabase values out of the client config", () => {
    const config = validateConfig({
      ...validEnv,
      INHERITANCE_REGISTRY_CONTRACT_ADDRESS: ""
    });

    expect(config.thirdweb.secretKey).toBe("thirdweb-secret-key");
    expect(config.supabase.sessionKeyEncryptionKey).toBe(validEnv.SESSION_KEY_ENCRYPTION_KEY);
    // An empty env override is not a disable: contract addresses fall back to the
    // committed config/public-chains.json (the source of truth, per CONTEXT D10).
    expect(config.somnia.inheritanceRegistryContractAddress).toBe(
      "0xBaa6f77B9ea4E1ecaeEE7c64526bbb51d59E0e14"
    );
  });

  it("fails with safe diagnostics when required values are missing", () => {
    expect(() => validateConfig({})).toThrow(ConfigValidationError);

    try {
      validateConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = formatConfigError(error as ConfigValidationError);

      expect(message).toContain("THIRDWEB_SECRET_KEY");
      expect(message).not.toContain("SOMNIA_RPC_URL");
      expect(message).not.toContain("undefined");
    }
  });

  it("loads non-secret public chain metadata from config/public-chains.json", () => {
    const config = validateConfig({
      ...validEnv,
      INHERITANCE_REGISTRY_CONTRACT_ADDRESS: undefined
    });

    expect(config.publicChain.key).toBe("somnia-testnet");
    expect(config.somnia.rpcUrl).toBe("https://dream-rpc.somnia.network");
    expect(config.somnia.chainId).toBe(50312);
    expect(config.publicChain.nativeCurrency.symbol).toBe("STT");
  });

  it("loads public chain metadata independently of process cwd", () => {
    const previousCwd = cwd();
    chdir(previousCwd.endsWith("/agent") ? ".." : previousCwd);

    try {
      const config = validateConfig(validEnv);
      expect(config.publicChain.key).toBe("somnia-testnet");
    } finally {
      chdir(previousCwd);
    }
  });

  it.each([
    ["RISK_SCORE_ALERT_THRESHOLD", "101"],
    ["HEARTBEAT_INTERVAL_SECONDS", "0"],
    ["AUTO_CLAIM_ENABLED", "sometimes"]
  ])("rejects malformed %s", (key, value) => {
    expect(() => validateConfig({ ...validEnv, [key]: value })).toThrow(
      ConfigValidationError
    );
  });

  it("rejects malformed optional Telegram values when provided", () => {
    expect(() =>
      validateConfig({ ...validEnv, TELEGRAM_CHAT_ID: "not-numeric" })
    ).toThrow(ConfigValidationError);
  });

  it("rejects whitespace-only required secrets", () => {
    expect(() =>
      validateConfig({
        ...validEnv,
        THIRDWEB_SECRET_KEY: " ",
        SUPABASE_SERVICE_ROLE_KEY: " "
      })
    ).toThrow(ConfigValidationError);
  });

  it("rejects Telegram chat ID without a bot token", () => {
    expect(() =>
      validateConfig({
        ...validEnv,
        TELEGRAM_BOT_TOKEN: undefined
      })
    ).toThrow(ConfigValidationError);
  });

  it("rejects Telegram bot token without a bot username", () => {
    expect(() =>
      validateConfig({
        ...validEnv,
        TELEGRAM_BOT_USERNAME: undefined
      })
    ).toThrow(ConfigValidationError);
  });

  it("omits secret input values from diagnostics", () => {
    const secretEnv = {
      ...validEnv,
      SESSION_KEY_ENCRYPTION_KEY: "",
      THIRDWEB_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      TELEGRAM_BOT_TOKEN: "bad-token"
    };

    try {
      validateConfig(secretEnv);
    } catch (error) {
      const message = formatConfigError(error as ConfigValidationError);

      expect(message).toContain("SESSION_KEY_ENCRYPTION_KEY");
      expect(message).toContain("THIRDWEB_SECRET_KEY");
      expect(message).toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(message).toContain("TELEGRAM_BOT_TOKEN");
      expect(message).not.toContain("bad-private-key");
      expect(message).not.toContain("bad-token");
    }
  });

  it("can validate an explicit env source without reading process.env", () => {
    const config = loadConfig({ env: validEnv, loadDotenv: false });

    expect(config.somnia.rpcUrl).toBe("https://dream-rpc.somnia.network");
  });

  it("uses an explicit dotenv path when provided", () => {
    expect(() =>
      loadConfig({
        env: validEnv,
        dotenvPath: "C:/tmp/non-existent-riskguard.env"
      })
    ).not.toThrow();
  });
});
