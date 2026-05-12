export { main, runCli } from "./main.js";
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
export { AuditEventsRepository, auditEventSchema } from "./persistence/audit-events.repository.js";
export { UsersRepository, userSchema } from "./persistence/users.repository.js";
export { JsonRepositoryError, JsonStore } from "./persistence/json-store.js";
export { denyExecution, policyDecisionSchema } from "./policies/execution-policy.js";
export {
  SomniaAgentKitClient,
  SomniaExecutionDisabledError,
  SomniaIntegrationUnavailableError,
  createSomniaAgentKitClient
} from "./integrations/somnia/somnia-agent-kit.client.js";
