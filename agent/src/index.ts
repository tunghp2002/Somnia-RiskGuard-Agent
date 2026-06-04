export { main, runCli, startAgentRuntime } from "./main.js";
export {
  ConfigValidationError,
  agentEnvSchema,
  formatConfigError,
  loadConfig,
  secretEnvKeys,
  validateConfig,
  type AgentConfig,
  type LoadConfigOptions
} from "./config/env.js";
export { createLogger, loggerRedactPaths } from "./config/logger.js";
export { createAgentApiServer } from "./api/server.js";
export { failure, sendJson, success } from "./api/response.js";
export { AuditService } from "./services/audit.service.js";
export { SetupService, setupWalletRequestSchema } from "./services/setup.service.js";
export {
  DemoScenarioService,
  demoScenarioNameSchema,
  demoScenarioRequestSchema
} from "./services/demo-scenario.service.js";
export {
  HeartbeatService,
  HeartbeatServiceError,
  type HeartbeatReminderNotifier,
  deadmanPolicyRequestSchema,
  heartbeatCheckInRequestSchema,
  heartbeatSettingsRequestSchema
} from "./services/heartbeat.service.js";
export { TelegramHeartbeatReminderNotifier } from "./services/heartbeat-reminder-notifier.js";
export { TelegramRewardClaimNotifier } from "./services/reward-claim-notifier.js";
export { PortfolioService } from "./services/portfolio.service.js";
export {
  RewardClaimService,
  RewardClaimServiceError,
  rewardFixtureRequestSchema,
  rewardPolicyCheckRequestSchema,
  rewardRunRequestSchema,
  rewardSettingsRequestSchema,
  type RewardClaimNotifier
} from "./services/reward-claim.service.js";
export {
  TelegramAlertService,
  TelegramAlertServiceError,
  telegramBindingRequestSchema,
  telegramCallbackRequestSchema
} from "./services/telegram-alert.service.js";
export { PortfolioMonitorJob } from "./jobs/portfolio-monitor.job.js";
export { HeartbeatJob } from "./jobs/heartbeat.job.js";
export { RewardClaimJob } from "./jobs/reward-claim.job.js";
export { AuditEventsRepository, auditEventSchema } from "./persistence/audit-events.repository.js";
export { AlertsRepository, alertRecordSchema } from "./persistence/alerts.repository.js";
export { UsersRepository, userSchema } from "./persistence/users.repository.js";
export {
  HeartbeatsRepository,
  heartbeatRecordSchema,
  heartbeatContractStateSchema
} from "./persistence/heartbeats.repository.js";
export {
  TelegramBindingsRepository,
  telegramBindingSchema
} from "./persistence/telegram-bindings.repository.js";
export {
  ActionNoncesRepository,
  actionNonceSchema
} from "./persistence/action-nonces.repository.js";
export {
  PortfolioSnapshotsRepository,
  portfolioSnapshotSchema
} from "./persistence/portfolio-snapshots.repository.js";
export {
  RiskSnapshotsRepository,
  riskSnapshotSchema
} from "./persistence/risk-snapshots.repository.js";
export {
  RewardClaimsRepository,
  rewardClaimSchema,
  rewardClaimsDataSchema,
  rewardFixtureSchema,
  rewardSettingsSchema
} from "./persistence/reward-claims.repository.js";
export { JsonRepositoryError, JsonStore } from "./persistence/json-store.js";
export {
  denyExecution,
  evaluateTelegramSafeActionApproval,
  policyDecisionSchema
} from "./policies/execution-policy.js";
export {
  deadmanExecutionPolicyInputSchema,
  evaluateDeadmanExecutionPolicy
} from "./policies/deadman-policy.js";
export {
  evaluateRewardClaimPolicy,
  rewardClaimPolicyInputSchema
} from "./policies/reward-claim-policy.js";
export {
  decodeTelegramCallback,
  encodeTelegramCallback,
  createCompactTelegramCallbackData,
  signTelegramCallback,
  telegramCallbackPayloadSchema,
  verifyCompactTelegramCallbackData,
  verifyTelegramCallback
} from "./integrations/telegram/callback-signing.js";
export {
  DisabledTelegramClient,
  TelegramBotApiClient,
  createTelegramClient
} from "./integrations/telegram/telegram.client.js";
export {
  SomniaAgentKitClient,
  SomniaExecutionDisabledError,
  SomniaIntegrationUnavailableError,
  createSomniaAgentKitClient
} from "./integrations/somnia/somnia-agent-kit.client.js";
