import "./config/network.js";

import { pathToFileURL } from "node:url";
import type { Server } from "node:http";

import {
  ConfigValidationError,
  formatConfigError,
  loadConfig,
  PublicConfigValidationError,
  type AgentConfig,
  type LoadConfigOptions,
} from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createAgentApiServer } from "./api/server.js";
import { ApprovalScannerService } from "./services/approval-scanner/service.js";
import { z } from "zod";

import { AuditEventsRepository, auditEventsSchema } from "./persistence/audit-events.repository.js";
import { AlertsRepository, alertsSchema } from "./persistence/alerts.repository.js";
import { ActionNoncesRepository, actionNonceSchema } from "./persistence/action-nonces.repository.js";
import { PortfolioSnapshotsRepository, portfolioSnapshotsSchema } from "./persistence/portfolio-snapshots.repository.js";
import { RiskSnapshotsRepository, riskSnapshotSchema } from "./persistence/risk-snapshots.repository.js";
import { TelegramBindingsRepository } from "./persistence/telegram-bindings.repository.js";
import { SupabaseUsersRepository } from "./persistence/users.repository.js";
import { HeartbeatsRepository, heartbeatsSchema } from "./persistence/heartbeats.repository.js";
import { RewardClaimsRepository, rewardClaimsDataSchema } from "./persistence/reward-claims.repository.js";
import {
  RiskGuardPendingUserOpsRepository,
  riskGuardPendingUserOpsSchema
} from "./persistence/riskguard-pending-userops.repository.js";
import { SupabaseSessionKeysRepository } from "./persistence/session-keys.repository.js";
import { SupabaseJsonStore } from "./persistence/supabase-json-store.js";
import type { RepositoryStore } from "./persistence/json-store.js";
import {
  createTelegramClient,
  type TelegramClient,
  type TelegramPollingHandle,
} from "./integrations/telegram/telegram.client.js";
import {
  createSomniaAgentKitClient,
  type SomniaAgentKitClient,
} from "./integrations/somnia/somnia-agent-kit.client.js";
import { AuditService } from "./services/audit.service.js";
import { TelegramHeartbeatReminderNotifier } from "./services/heartbeat-reminder-notifier.js";
import { TelegramRewardClaimNotifier } from "./services/reward-claim-notifier.js";
import { SetupService } from "./services/setup.service.js";
import { DemoScenarioService } from "./services/demo-scenario.service.js";
import { HeartbeatService } from "./services/heartbeat.service.js";
import { RewardClaimService } from "./services/reward-claim.service.js";
import { TelegramAlertService } from "./services/telegram-alert.service.js";
import { RiskGuardApprovalService } from "./services/riskguard/approval.service.js";
import { RiskGuardPendingUserOpService } from "./services/riskguard/pending-userop.service.js";
import { RiskGuardReviewBudgetService } from "./services/riskguard/review-budget.service.js";
import { TelegramCheckInService } from "./services/telegram-check-in.service.js";
import { TelegramConnectService } from "./services/telegram-connect.service.js";
import { SessionKeyService } from "./services/session-key.service.js";
import { PortfolioService } from "./services/portfolio.service.js";
import { PortfolioMonitorJob } from "./jobs/portfolio-monitor.job.js";
import { HeartbeatJob } from "./jobs/heartbeat.job.js";
import { RewardClaimJob } from "./jobs/reward-claim.job.js";
import { RiskGuardAgentReviewJob } from "./jobs/riskguard-agent-review.job.js";

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
  somniaClient?: SomniaAgentKitClient;
  startJobs?: boolean;
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
  options: StartAgentRuntimeOptions = {},
): Promise<AgentRuntime> {
  const logger = createLogger(config);
  const users = new SupabaseUsersRepository(
    config.supabase.url,
    config.supabase.serviceRoleKey,
  );
  const auditEvents = new AuditEventsRepository(undefined, createMemoryStore(auditEventsSchema, []));
  const audit = new AuditService(auditEvents, logger);
  const portfolioSnapshots = new PortfolioSnapshotsRepository(undefined, createMemoryStore(portfolioSnapshotsSchema, []));
  const riskSnapshots = new RiskSnapshotsRepository(undefined, createMemoryStore(z.array(riskSnapshotSchema), []));
  const telegramBindings = new TelegramBindingsRepository(undefined, undefined, users);
  const heartbeatsRepository = new HeartbeatsRepository(undefined, createMemoryStore(heartbeatsSchema, []));
  const rewardClaims = new RewardClaimsRepository(undefined, createMemoryStore(rewardClaimsDataSchema, {
    settings: [],
    fixtures: [],
    claims: [],
  }));
  const alerts = new AlertsRepository(undefined, createMemoryStore(alertsSchema, []));
  const actionNonces = new ActionNoncesRepository(undefined, createMemoryStore(z.array(actionNonceSchema), []));
  const riskGuardPendingUserOpsRepository = new RiskGuardPendingUserOpsRepository(
    undefined,
    createSupabaseStore(config, "riskguard-pending-userops.json", riskGuardPendingUserOpsSchema, [])
  );
  const sessionKeysRepository = new SupabaseSessionKeysRepository(
    config.supabase.url,
    config.supabase.serviceRoleKey,
  );
  const sessionKeys = new SessionKeyService(config, sessionKeysRepository);
  const telegramClient = options.telegramClient ?? createTelegramClient(config);
  const somnia = options.somniaClient ?? createSomniaAgentKitClient(config);
  const riskGuardPendingUserOps = new RiskGuardPendingUserOpService(
    config,
    riskGuardPendingUserOpsRepository,
    audit,
  );
  const riskGuardApprovals = new RiskGuardApprovalService(config, audit, sessionKeys);
  const riskGuardReviewBudget = new RiskGuardReviewBudgetService(config, audit, sessionKeys);
  const approvalScanner = new ApprovalScannerService(config);
  const telegramAlerts = new TelegramAlertService(
    config,
    users,
    telegramBindings,
    alerts,
    actionNonces,
    portfolioSnapshots,
    telegramClient,
    audit,
    riskGuardApprovals,
    riskGuardPendingUserOps,
  );
  const telegramConnect = new TelegramConnectService(
    telegramAlerts,
    config.telegram.botUsername
      ? { botUsername: config.telegram.botUsername }
      : {},
  );
  const telegramCheckIn = new TelegramCheckInService(
    config,
    telegramBindings,
    sessionKeys,
    audit,
  );
  const setupService = new SetupService(users, config, audit, sessionKeys);
  const heartbeatReminderNotifier = new TelegramHeartbeatReminderNotifier(
    telegramBindings,
    telegramClient,
  );
  const rewardClaimNotifier = new TelegramRewardClaimNotifier(
    telegramBindings,
    telegramClient,
    audit,
  );
  const heartbeats = new HeartbeatService(
    heartbeatsRepository,
    config,
    audit,
    undefined,
    heartbeatReminderNotifier,
  );
  const rewards = new RewardClaimService(
    rewardClaims,
    config,
    audit,
    somnia,
    rewardClaimNotifier,
    users,
  );
  const portfolioService = new PortfolioService(
    users,
    portfolioSnapshots,
    audit,
    undefined,
    { demoMode: true },
  );
  const portfolioMonitorJob = new PortfolioMonitorJob(portfolioService);
  const heartbeatJob = new HeartbeatJob(heartbeats);
  const rewardClaimJob = new RewardClaimJob(rewards);
  const riskGuardAgentReviewJob = new RiskGuardAgentReviewJob(
    config,
    telegramBindings,
    telegramClient,
    audit,
    telegramAlerts,
  );
  const demoScenarios = new DemoScenarioService(
    users,
    portfolioSnapshots,
    riskSnapshots,
    heartbeatsRepository,
    rewardClaims,
    audit,
    config,
  );
  const apiServer = createAgentApiServer({
    setupService,
    auditEvents,
    portfolioSnapshots,
    riskSnapshots,
    demoScenarios,
    telegramAlerts,
    telegramConnect,
    heartbeats,
    rewards,
    riskGuardPendingUserOps,
    riskGuardReviewBudget,
    approvalScanner,
    publicChain: config.publicChain,
    health: async () => ({
      ok: true,
      telegram: await telegramAlerts.health(),
      somnia: await somnia.health(),
      publicChain: config.publicChain,
    }),
  });

  if (config.somnia.monitoredWalletAddress) {
    await users.upsertMonitoredWallet(config.somnia.monitoredWalletAddress);
    await audit.record({
      eventType: "setup.wallet.bootstrapped",
      status: "succeeded",
      metadata: {
        walletAddress: config.somnia.monitoredWalletAddress,
        source: "MONITORED_WALLET_ADDRESS",
      },
    });
  }

  // Cloud hosts (Render/Railway/Fly/…) inject the port to bind via $PORT.
  const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  const requestedPort =
    options.apiPort ?? (envPort && Number.isFinite(envPort) ? envPort : 3001);
  await listen(apiServer, requestedPort);
  const address = apiServer.address();
  const apiPort =
    typeof address === "object" && address ? address.port : requestedPort;

  const telegramPolling = telegramClient.startPolling?.({
    handleCallback: async (update) =>
      telegramAlerts.processCallback({
        chatId: update.chatId,
        ...(update.messageId
          ? { messageId: update.messageId }
          : {}),
        ...(update.telegramUserId
          ? { telegramUserId: update.telegramUserId }
          : {}),
        data: update.data,
      }),
    handleTextMessage: async (update) =>
      /^\/checkin(?:@\w+)?$/i.test(update.text.trim())
        ? telegramCheckIn.handleText({
          chatId: update.chatId,
          ...(update.telegramUserId
            ? { telegramUserId: update.telegramUserId }
            : {}),
          text: update.text,
        })
        : telegramConnect.confirmFromText({
        chatId: update.chatId,
        ...(update.telegramUserId
          ? { telegramUserId: update.telegramUserId }
          : {}),
        ...(update.telegramUsername
          ? { telegramUsername: update.telegramUsername }
          : {}),
        ...(update.telegramDisplayName
          ? { telegramDisplayName: update.telegramDisplayName }
          : {}),
        text: update.text,
      }),
    commands: [
      {
        command: "checkin",
        description: "Renew smart account heartbeat",
      },
    ],
    logger,
  });

  logger.info(
    {
      apiPort,
      apiHost: "0.0.0.0",
      telegram: await telegramAlerts.health(),
      somnia: await somnia.health(),
      publicChain: config.publicChain.key,
    },
    "agent runtime started",
  );

  const jobTimers =
    options.startJobs === false
      ? []
      : startRuntimeJobs({
          logger,
          portfolioMonitorJob,
          heartbeatJob,
          rewardClaimJob,
          riskGuardAgentReviewJob,
        });

  return {
    apiServer,
    apiPort,
    ...(telegramPolling ? { telegramPolling } : {}),
    async stop() {
      for (const timer of jobTimers) {
        clearInterval(timer);
      }
      telegramPolling?.stop();
      await close(apiServer);
    },
  };
}

function createSupabaseStore<T>(
  config: AgentConfig,
  filename: string,
  schema: z.ZodType<T>,
  defaultValue: T,
): RepositoryStore<T> {
  return new SupabaseJsonStore({
    filename,
    schema,
    defaultValue,
    supabaseUrl: config.supabase.url,
    serviceRoleKey: config.supabase.serviceRoleKey,
  });
}

function createMemoryStore<T>(
  schema: z.ZodType<T>,
  defaultValue: T,
): RepositoryStore<T> {
  let value = schema.parse(cloneJson(defaultValue));
  let queue = Promise.resolve();

  return {
    async read() {
      return schema.parse(cloneJson(value));
    },
    async write(nextValue: T) {
      value = schema.parse(cloneJson(nextValue));
    },
    async update(mutator: (current: T) => T | Promise<T>) {
      const operation = queue.then(async () => {
        const current = schema.parse(cloneJson(value));
        const next = await mutator(current);
        value = schema.parse(cloneJson(next));
        return schema.parse(cloneJson(value));
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function startRuntimeJobs({
  logger,
  portfolioMonitorJob,
  heartbeatJob,
  rewardClaimJob,
  riskGuardAgentReviewJob,
}: {
  logger: ReturnType<typeof createLogger>;
  portfolioMonitorJob: PortfolioMonitorJob;
  heartbeatJob: HeartbeatJob;
  rewardClaimJob: RewardClaimJob;
  riskGuardAgentReviewJob: RiskGuardAgentReviewJob;
}) {
  const timers: NodeJS.Timeout[] = [];

  const schedule = (
    name: string,
    intervalMs: number,
    run: () => Promise<unknown>,
  ) => {
    let running = false;

    const tick = async () => {
      if (running) {
        logger.debug(
          { job: name },
          "agent job skipped because previous run is still active",
        );
        return;
      }

      running = true;
      try {
        const result = await run();
        logger.debug({ job: name, result }, "agent job completed");
      } catch (error) {
        logger.error(
          {
            job: name,
            error: error instanceof Error ? error.message : "unknown error",
          },
          "agent job failed",
        );
      } finally {
        running = false;
      }
    };

    void tick();
    timers.push(setInterval(() => void tick(), intervalMs));
  };

  schedule("portfolio-monitor", 300_000, () => portfolioMonitorJob.runOnce());
  schedule("heartbeat-reminders", 60_000, () => heartbeatJob.runOnce());
  schedule("reward-claims", 60_000, () => rewardClaimJob.runOnce());
  schedule("riskguard-agent-review", 15_000, () => riskGuardAgentReviewJob.runOnce());

  return timers;
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
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

    if (error instanceof PublicConfigValidationError) {
      console.error(
        `Agent public chain configuration is invalid:\n- ${error.message}`,
      );
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
