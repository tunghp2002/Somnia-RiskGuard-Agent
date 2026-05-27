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
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network",
  SOMNIA_CHAIN_ID: "50312",
  THIRDWEB_SECRET_KEY: "thirdweb-secret-key",
  SUPABASE_URL: "https://riskguard.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "supabase-service-role",
  SESSION_KEY_ENCRYPTION_KEY: "0x1111111111111111111111111111111111111111111111111111111111111111",
  GROQ_API_KEY: "groq-test-token",
  GROQ_MODEL: "llama-3.3-70b-versatile",
  DEEPSEEK_API_KEY: "deepseek-test-token",
  DEEPSEEK_MODEL: "deepseek-chat",
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
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret-value"
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
      GROQ_MODEL: "",
      DEEPSEEK_MODEL: "",
      INHERITANCE_REGISTRY_CONTRACT_ADDRESS: ""
    });

    expect(config.thirdweb.secretKey).toBe("thirdweb-secret-key");
    expect(config.supabase.sessionKeyEncryptionKey).toBe(validEnv.SESSION_KEY_ENCRYPTION_KEY);
    expect(config.llm.groq.model).toBe("llama-3.3-70b-versatile");
    expect(config.llm.deepSeek.model).toBe("deepseek-chat");
    expect(config.somnia.inheritanceRegistryContractAddress).toBeUndefined();
  });

  it("fails with safe diagnostics when required values are missing", () => {
    expect(() => validateConfig({})).toThrow(ConfigValidationError);

    try {
      validateConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = formatConfigError(error as ConfigValidationError);

      expect(message).toContain("GROQ_API_KEY");
      expect(message).not.toContain("SOMNIA_RPC_URL");
      expect(message).not.toContain("undefined");
    }
  });

  it("loads non-secret public chain metadata from config/public-chains.json", () => {
    const config = validateConfig({
      ...validEnv,
      SOMNIA_RPC_URL: undefined,
      SOMNIA_CHAIN_ID: undefined,
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

  it("rejects whitespace-only required secrets and model names", () => {
    expect(() =>
      validateConfig({
        ...validEnv,
        GROQ_API_KEY: " ",
        GROQ_MODEL: " ",
        DEEPSEEK_API_KEY: " ",
        DEEPSEEK_MODEL: " "
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
      GROQ_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      TELEGRAM_BOT_TOKEN: "bad-token"
    };

    try {
      validateConfig(secretEnv);
    } catch (error) {
      const message = formatConfigError(error as ConfigValidationError);

      expect(message).toContain("SESSION_KEY_ENCRYPTION_KEY");
      expect(message).toContain("GROQ_API_KEY");
      expect(message).toContain("DEEPSEEK_API_KEY");
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
