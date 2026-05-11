import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";

import {
  ConfigValidationError,
  formatConfigError,
  loadConfig,
  validateConfig
} from "./env.js";

const validAgentPrivateKey = `0x${"a".repeat(64)}`;

const validEnv = {
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network",
  SOMNIA_CHAIN_ID: "50312",
  AGENT_WALLET_ADDRESS: new Wallet(validAgentPrivateKey).address,
  AGENT_PRIVATE_KEY: validAgentPrivateKey,
  GROQ_API_KEY: "groq-test-token",
  GROQ_MODEL: "llama-3.3-70b-versatile",
  DEEPSEEK_API_KEY: "deepseek-test-token",
  DEEPSEEK_MODEL: "deepseek-chat",
  RISK_SCORE_ALERT_THRESHOLD: "70",
  HEARTBEAT_INTERVAL_SECONDS: "86400",
  HEARTBEAT_GRACE_SECONDS: "3600",
  DEAD_MAN_SWITCH_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222",
  AUTO_CLAIM_ENABLED: "false",
  MAX_CLAIM_GAS_USD: "1",
  MIN_REWARD_VALUE_USD: "2",
  TELEGRAM_BOT_TOKEN: "123456:telegram_test_token",
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

  it("fails with safe diagnostics when required values are missing", () => {
    expect(() => validateConfig({})).toThrow(ConfigValidationError);

    try {
      validateConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = formatConfigError(error as ConfigValidationError);

      expect(message).toContain("SOMNIA_RPC_URL");
      expect(message).toContain("AGENT_PRIVATE_KEY");
      expect(message).not.toContain("undefined");
    }
  });

  it.each([
    ["SOMNIA_RPC_URL", "not-a-url"],
    ["SOMNIA_CHAIN_ID", "0"],
    ["SOMNIA_CHAIN_ID", `${Number.MAX_SAFE_INTEGER + 2}`],
    ["AGENT_WALLET_ADDRESS", "0x123"],
    ["AGENT_PRIVATE_KEY", "0x123"],
    ["AGENT_PRIVATE_KEY", `0x${"0".repeat(64)}`],
    ["RISK_SCORE_ALERT_THRESHOLD", "101"],
    ["HEARTBEAT_INTERVAL_SECONDS", "0"],
    ["AUTO_CLAIM_ENABLED", "sometimes"],
    ["DEAD_MAN_SWITCH_CONTRACT_ADDRESS", "0xabc"]
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

  it("rejects a configured agent wallet address that does not match the private key", () => {
    expect(() =>
      validateConfig({
        ...validEnv,
        AGENT_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111"
      })
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

  it("rejects partial Telegram configuration", () => {
    expect(() =>
      validateConfig({
        ...validEnv,
        TELEGRAM_CHAT_ID: undefined
      })
    ).toThrow(ConfigValidationError);
  });

  it("omits secret input values from diagnostics", () => {
    const secretEnv = {
      ...validEnv,
      AGENT_PRIVATE_KEY: "bad-private-key",
      GROQ_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      TELEGRAM_BOT_TOKEN: "bad-token"
    };

    try {
      validateConfig(secretEnv);
    } catch (error) {
      const message = formatConfigError(error as ConfigValidationError);

      expect(message).toContain("AGENT_PRIVATE_KEY");
      expect(message).toContain("GROQ_API_KEY");
      expect(message).toContain("DEEPSEEK_API_KEY");
      expect(message).toContain("TELEGRAM_BOT_TOKEN");
      expect(message).not.toContain("bad-private-key");
      expect(message).not.toContain("bad-token");
    }
  });

  it("can validate an explicit env source without reading process.env", () => {
    const config = loadConfig({ env: validEnv, loadDotenv: false });

    expect(config.somnia.rpcUrl).toBe(validEnv.SOMNIA_RPC_URL);
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
