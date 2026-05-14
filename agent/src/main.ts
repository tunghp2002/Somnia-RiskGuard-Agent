import { pathToFileURL } from "node:url";
import type { Server } from "node:http";

import {
  ConfigValidationError,
  formatConfigError,
  loadConfig,
  type AgentConfig,
  type LoadConfigOptions
} from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createAgentApiServer } from "./api/server.js";
import { AuditEventsRepository } from "./persistence/audit-events.repository.js";
import { AlertsRepository } from "./persistence/alerts.repository.js";
import { ActionNoncesRepository } from "./persistence/action-nonces.repository.js";
import { PortfolioSnapshotsRepository } from "./persistence/portfolio-snapshots.repository.js";
import { RiskSnapshotsRepository } from "./persistence/risk-snapshots.repository.js";
import { TelegramBindingsRepository } from "./persistence/telegram-bindings.repository.js";
import { UsersRepository } from "./persistence/users.repository.js";
import { HeartbeatsRepository } from "./persistence/heartbeats.repository.js";
import { RewardClaimsRepository } from "./persistence/reward-claims.repository.js";
import { DeepSeekClient } from "./integrations/llm/deepseek.client.js";
import { GroqClient } from "./integrations/llm/groq.client.js";
import {
  createTelegramClient,
  type TelegramClient,
  type TelegramPollingHandle
} from "./integrations/telegram/telegram.client.js";
import { EthersDeadManSwitchStateReader } from "./integrations/somnia/deadman-switch.client.js";
import { createSomniaAgentKitClient } from "./integrations/somnia/somnia-agent-kit.client.js";
import { AuditService } from "./services/audit.service.js";
import { TelegramHeartbeatReminderNotifier } from "./services/heartbeat-reminder-notifier.js";
import { TelegramRewardClaimNotifier } from "./services/reward-claim-notifier.js";
import { RiskScoreService } from "./services/risk-score.service.js";
import { SetupService } from "./services/setup.service.js";
import { HeartbeatService } from "./services/heartbeat.service.js";
import { RewardClaimService } from "./services/reward-claim.service.js";
import { TelegramAlertService } from "./services/telegram-alert.service.js";

export interface MainOptions extends LoadConfigOptions {
  startRuntime?: (config: AgentConfig) => Promise<void> | void;
}

export interface AgentRuntime {
  apiServer: Server;
  apiPort: number;
  telegramPolling?: TelegramPollingHandle;
  stop(): Promise<void>;
}

export interface StartAgentRuntimeOptions {
  apiPort?: number;
  telegramClient?: TelegramClient;
}

export async function main(options: MainOptions = {}): Promise<AgentConfig> {
  const config = loadConfig(options);

  if (options.startRuntime) {
    await options.startRuntime(config);
  } else {
    await startAgentRuntime(config);
  }

  return config;
}

export async function startAgentRuntime(
  config: AgentConfig,
  options: StartAgentRuntimeOptions = {}
): Promise<AgentRuntime> {
  const logger = createLogger(config);
  const users = new UsersRepository();
  const auditEvents = new AuditEventsRepository();
  const audit = new AuditService(auditEvents, logger);
  const portfolioSnapshots = new PortfolioSnapshotsRepository();
  const riskSnapshots = new RiskSnapshotsRepository();
  const telegramBindings = new TelegramBindingsRepository();
  const heartbeatsRepository = new HeartbeatsRepository();
  const rewardClaims = new RewardClaimsRepository();
  const alerts = new AlertsRepository();
  const actionNonces = new ActionNoncesRepository();
  const telegramClient = options.telegramClient ?? createTelegramClient(config);
  const somnia = createSomniaAgentKitClient(config);
  const riskScore = new RiskScoreService(config, riskSnapshots, audit, {
    primary: new GroqClient(config),
    fallback: new DeepSeekClient(config)
  });
  const telegramAlerts = new TelegramAlertService(
    config,
    users,
    telegramBindings,
    alerts,
    actionNonces,
    portfolioSnapshots,
    riskScore,
    telegramClient,
    audit
  );
  const setupService = new SetupService(users, config, audit);
  const heartbeatReminderNotifier = new TelegramHeartbeatReminderNotifier(
    telegramBindings,
    telegramClient
  );
  const rewardClaimNotifier = new TelegramRewardClaimNotifier(
    telegramBindings,
    telegramClient,
    audit
  );
  const deadManSwitchReader = new EthersDeadManSwitchStateReader(config);
  const heartbeats = new HeartbeatService(
    heartbeatsRepository,
    config,
    audit,
    undefined,
    heartbeatReminderNotifier,
    deadManSwitchReader
  );
  const rewards = new RewardClaimService(
    rewardClaims,
    config,
    audit,
    somnia,
    rewardClaimNotifier,
    users
  );
  const apiServer = createAgentApiServer({
    setupService,
    portfolioSnapshots,
    riskSnapshots,
    telegramAlerts,
    heartbeats,
    rewards,
    health: async () => ({
      ok: true,
      telegram: await telegramAlerts.health()
    })
  });
  const requestedPort = options.apiPort ?? 3001;
  await listen(apiServer, requestedPort);
  const address = apiServer.address();
  const apiPort = typeof address === "object" && address ? address.port : requestedPort;

  const telegramPolling = telegramClient.startPolling?.({
    handleCallback: async (update) =>
      telegramAlerts.processCallback({
        chatId: update.chatId,
        ...(update.telegramUserId ? { telegramUserId: update.telegramUserId } : {}),
        data: update.data
      }),
    logger
  });

  logger.info(
    {
      apiPort,
      telegram: await telegramAlerts.health()
    },
    "agent runtime started"
  );

  return {
    apiServer,
    apiPort,
    ...(telegramPolling ? { telegramPolling } : {}),
    async stop() {
      telegramPolling?.stop();
      await close(apiServer);
    }
  };
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function runCli(options: MainOptions = {}): Promise<void> {
  try {
    await main(options);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(formatConfigError(error));
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entrypoint) {
  await runCli();
}
