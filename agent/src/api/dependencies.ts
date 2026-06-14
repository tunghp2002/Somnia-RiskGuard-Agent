import type { PublicChainMetadata } from "../config/public-chain.js";
import type { AuditEventsRepository } from "../persistence/audit-events.repository.js";
import type { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import type { RiskSnapshotsRepository } from "../persistence/risk-snapshots.repository.js";
import type { ApprovalScannerService } from "../services/approval-scanner/service.js";
import type { DemoScenarioService } from "../services/demo-scenario.service.js";
import type { HeartbeatService } from "../services/heartbeat.service.js";
import type { RewardClaimService } from "../services/reward-claim.service.js";
import type { RiskGuardPendingUserOpService } from "../services/riskguard/pending-userop.service.js";
import type { RiskGuardReviewBudgetService } from "../services/riskguard/review-budget.service.js";
import type { SetupService } from "../services/setup.service.js";
import type { TelegramAlertService } from "../services/telegram-alert.service.js";
import type { TelegramConnectService } from "../services/telegram-connect.service.js";

export interface AgentApiDependencies {
  setupService: SetupService;
  auditEvents?: AuditEventsRepository;
  portfolioSnapshots?: PortfolioSnapshotsRepository;
  riskSnapshots?: RiskSnapshotsRepository;
  demoScenarios?: DemoScenarioService;
  telegramAlerts?: TelegramAlertService;
  telegramConnect?: TelegramConnectService;
  heartbeats?: HeartbeatService;
  rewards?: RewardClaimService;
  riskGuardPendingUserOps?: RiskGuardPendingUserOpService;
  riskGuardReviewBudget?: RiskGuardReviewBudgetService;
  approvalScanner?: ApprovalScannerService;
  publicChain?: PublicChainMetadata;
  health?: () => Promise<unknown> | unknown;
}
