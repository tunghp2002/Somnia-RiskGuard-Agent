import { validateConfig, type AgentConfig } from "../config/env.js";

export const validEnv = {
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  THIRDWEB_SECRET_KEY: "thirdweb-secret-key",
  SUPABASE_URL: "https://riskguard.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "supabase-service-role",
  SESSION_KEY_ENCRYPTION_KEY: `0x${"a".repeat(64)}`,
  AGENT_WALLET_ADDRESS: "0x9999999999999999999999999999999999999999",
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

export function createTestConfig(): AgentConfig {
  return validateConfig(validEnv);
}
