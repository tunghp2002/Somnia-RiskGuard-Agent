import { Wallet } from "ethers";

import type { AgentConfig } from "../config/env.js";
import { validateConfig } from "../config/env.js";

const validAgentPrivateKey = `0x${"a".repeat(64)}`;

export const validEnv = {
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
  INHERITANCE_REGISTRY_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222",
  AUTO_CLAIM_ENABLED: "false",
  MAX_CLAIM_GAS_USD: "1",
  MIN_REWARD_VALUE_USD: "2",
  TELEGRAM_BOT_TOKEN: "123456:telegram_test_token",
  TELEGRAM_BOT_USERNAME: "RiskGuardBot",
  TELEGRAM_CHAT_ID: "987654321",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret-value"
};

export function createTestConfig(): AgentConfig {
  return validateConfig(validEnv);
}
