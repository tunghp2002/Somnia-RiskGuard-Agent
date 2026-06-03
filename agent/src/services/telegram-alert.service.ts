import { randomUUID } from "node:crypto";

import { formatUnits, getAddress, verifyMessage } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../config/env.js";
import type {
  AlertRecord,
  AlertSeverity,
  AlertsRepository
} from "../persistence/alerts.repository.js";
import type { ActionNoncesRepository } from "../persistence/action-nonces.repository.js";
import type { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import type { RiskSnapshotRecord } from "../persistence/risk-snapshots.repository.js";
import type { TelegramBindingsRepository } from "../persistence/telegram-bindings.repository.js";
import type { UsersRepository } from "../persistence/users.repository.js";
import {
  createCompactTelegramCallbackData,
  verifyCompactTelegramCallbackData,
  type TelegramActionType
} from "../integrations/telegram/callback-signing.js";
import type { TelegramClient } from "../integrations/telegram/telegram.client.js";
import {
  evaluateTelegramSafeActionApproval,
  type PolicyDecision
} from "../policies/execution-policy.js";
import type { AuditService } from "./audit.service.js";
import type { RiskScoreService } from "./risk-score.service.js";
import {
  riskGuardPendingApprovalRequestSchema,
  type RiskGuardPendingApprovalRequest
} from "./riskguard-approval.service.js";

export const telegramBindingRequestSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    chatId: z.string().regex(/^-?\d+$/),
    telegramUserId: z.string().regex(/^\d+$/).optional(),
    telegramUsername: z.string().min(1).max(64).optional(),
    telegramDisplayName: z.string().min(1).max(128).optional(),
    smartAccountAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value))
      .optional()
  })
  .strict();

const signedProofFieldsSchema = z
  .object({
    signature: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

const signedWalletMutationSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    signature: z.string().min(1),
    message: z.string().min(1)
  })
  .strict()
  .superRefine(validateSignedWalletMutation);

export const telegramSignedBindingRequestSchema = telegramBindingRequestSchema
  .merge(signedProofFieldsSchema)
  .superRefine(validateSignedWalletMutation);

export const telegramUnlinkRequestSchema = signedWalletMutationSchema;

export const riskGuardAgentReviewRequestedSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    smartAccountAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    guardedTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    requestTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  })
  .strict();

export const telegramCallbackRequestSchema = z
  .object({
    chatId: z.string().regex(/^-?\d+$/),
    telegramUserId: z.string().regex(/^\d+$/).optional(),
    data: z.string().min(1)
  })
  .strict();

export type TelegramBindingRequest = z.infer<typeof telegramBindingRequestSchema>;
export type TelegramSignedBindingRequest = z.infer<typeof telegramSignedBindingRequestSchema>;
export type TelegramUnlinkRequest = z.infer<typeof telegramUnlinkRequestSchema>;
export type RiskGuardAgentReviewRequested = z.infer<typeof riskGuardAgentReviewRequestedSchema>;
export type TelegramCallbackRequest = z.infer<typeof telegramCallbackRequestSchema>;

function validateSignedWalletMutation(
  input: { walletAddress: string; message: string; signature: string },
  context: z.RefinementCtx
) {
  let recoveredAddress: string;

  try {
    recoveredAddress = verifyMessage(input.message, input.signature);
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Signature must be a valid signed-message proof",
      path: ["signature"]
    });
    return;
  }

  if (getAddress(recoveredAddress) !== input.walletAddress) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Signature must recover the submitted wallet address",
      path: ["signature"]
    });
  }

  if (!input.message.toLowerCase().includes(input.walletAddress.toLowerCase())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Signed message must include the submitted wallet address",
      path: ["message"]
    });
  }
}

export class TelegramAlertServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "TelegramAlertServiceError";
  }
}

export interface TelegramCallbackResult {
  ok: boolean;
  message: string;
  policyDecision?: PolicyDecision;
}

export interface RiskGuardApprovalSubmitter {
  submitApproval(input: {
    smartAccountAddress: string;
    txHash: string;
  }): Promise<{ txHash: string; approvalStore: string }>;
}

function severityForScore(score: number): AlertSeverity {
  if (score >= 90) {
    return "critical";
  }

  if (score >= 70) {
    return "high";
  }

  if (score >= 40) {
    return "medium";
  }

  return "low";
}

function summarizeReason(explanation: string): string {
  return explanation.length > 240 ? `${explanation.slice(0, 237)}...` : explanation;
}

function formatAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatNativeValue(valueWei: string): string {
  try {
    const formatted = formatUnits(valueWei, 18);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");

    return `${whole}${trimmedFraction ? `.${trimmedFraction}` : ""} STT`;
  } catch {
    return `${valueWei} wei`;
  }
}

export class TelegramAlertService {
  public constructor(
    private readonly config: AgentConfig,
    private readonly users: UsersRepository,
    private readonly bindings: TelegramBindingsRepository,
    private readonly alerts: AlertsRepository,
    private readonly nonces: ActionNoncesRepository,
    private readonly portfolios: PortfolioSnapshotsRepository,
    private readonly riskScore: RiskScoreService,
    private readonly telegram: TelegramClient,
    private readonly audit: AuditService,
    private readonly riskGuardApprovals?: RiskGuardApprovalSubmitter
  ) {}

  public async health() {
    const clientHealth = await this.telegram.health();
    return {
      ...clientHealth,
      configured: this.config.telegram.enabled
    };
  }

  public async linkChat(input: TelegramBindingRequest) {
    const parsed = telegramBindingRequestSchema.parse(input);

    if (!this.config.telegram.enabled) {
      await this.audit.record({
        eventType: "telegram.binding.failed",
        status: "failed",
        metadata: {
          walletAddress: parsed.walletAddress,
          reason: "telegram_not_configured"
        }
      });
      throw new TelegramAlertServiceError(
        "telegram_not_configured",
        "Telegram is not configured"
      );
    }

    const user = await this.users.findByWalletAddress(parsed.walletAddress);

    if (!user) {
      throw new TelegramAlertServiceError(
        "monitored_wallet_not_found",
        "Monitored wallet is not registered",
        404
      );
    }

    const binding = await this.bindings.upsert({
      userId: user.userId,
      walletAddress: parsed.walletAddress,
      chatId: parsed.chatId,
      ...(parsed.telegramUserId ? { telegramUserId: parsed.telegramUserId } : {}),
      ...(parsed.telegramUsername ? { telegramUsername: parsed.telegramUsername } : {}),
      ...(parsed.telegramDisplayName ? { telegramDisplayName: parsed.telegramDisplayName } : {}),
      ...(parsed.smartAccountAddress ? { smartAccountAddress: parsed.smartAccountAddress } : {})
    });

    await this.audit.record({
      eventType: "telegram.binding.saved",
      status: "succeeded",
      metadata: {
        userId: user.userId,
        walletAddress: parsed.walletAddress,
        chatId: parsed.chatId,
        telegramUserId: parsed.telegramUserId,
        telegramUsername: parsed.telegramUsername,
        telegramDisplayName: parsed.telegramDisplayName,
        smartAccountAddress: parsed.smartAccountAddress
      }
    });

    return binding;
  }

  public latestBindingForWallet(walletAddress: string) {
    return this.bindings.latestForWallet(walletAddress);
  }

  public async sendRiskGuardAgentReviewRequested(input: RiskGuardAgentReviewRequested) {
    const parsed = riskGuardAgentReviewRequestedSchema.parse(input);
    const binding = await this.bindings.attachSmartAccount(
      parsed.walletAddress,
      parsed.smartAccountAddress
    );

    if (!binding) {
      throw new TelegramAlertServiceError(
        "telegram_binding_not_found",
        "No Telegram binding is connected for this wallet.",
        404
      );
    }

    await this.telegram.sendMessage({
      chatId: binding.chatId,
      text: [
        "Somnia Agent review requested.",
        `Smart Account: ${formatAddress(parsed.smartAccountAddress)}`,
        `Guarded Tx: ${formatAddress(parsed.guardedTxHash)}`,
        `Request Tx: ${formatAddress(parsed.requestTxHash)}`,
        "RiskGuard will send the agent decision here after the Somnia callback finalizes."
      ].join("\n")
    });

    await this.audit.record({
      eventType: "riskguard.agent-review.requested.telegram.sent",
      status: "succeeded",
      metadata: {
        walletAddress: parsed.walletAddress,
        smartAccountAddress: parsed.smartAccountAddress,
        guardedTxHash: parsed.guardedTxHash,
        requestTxHash: parsed.requestTxHash
      }
    });

    return { sent: true };
  }

  public async sendRiskGuardApprovalRequest(input: RiskGuardPendingApprovalRequest) {
    const parsed = riskGuardPendingApprovalRequestSchema.parse(input);
    const binding = parsed.walletAddress
      ? await this.bindings.latestForWallet(parsed.walletAddress)
      : await this.bindings.latestForSmartAccount(parsed.smartAccountAddress);

    if (!binding) {
      await this.audit.record({
        eventType: "riskguard.approval.skipped",
        status: "skipped",
        metadata: {
          walletAddress: parsed.walletAddress,
          smartAccountAddress: parsed.smartAccountAddress,
          txHash: parsed.txHash,
          reason: "missing_telegram_binding"
        }
      });
      throw new TelegramAlertServiceError(
        "telegram_binding_not_found",
        "No Telegram binding is connected for this smart account.",
        404
      );
    }

    const health = await this.telegram.health();
    if (!health.ok) {
      throw new TelegramAlertServiceError(
        "telegram_unhealthy",
        health.reason ?? "Telegram is not healthy",
        503
      );
    }

    const buttons = await this.buildRiskGuardButtons(
      binding,
      parsed.smartAccountAddress,
      parsed.txHash
    );
    const sent = await this.telegram.sendMessage({
      chatId: binding.chatId,
      text: this.formatRiskGuardApprovalMessage(parsed),
      buttons
    });

    await this.audit.record({
      eventType: "riskguard.approval.requested",
      status: "succeeded",
      metadata: {
        userId: binding.userId,
        walletAddress: binding.walletAddress,
        smartAccountAddress: parsed.smartAccountAddress,
        txHash: parsed.txHash,
        telegramMessageId: sent.messageId
      }
    });

    return {
      sent: true,
      chatId: binding.chatId,
      telegramMessageId: sent.messageId
    };
  }

  public async unlinkChat(walletAddress: string) {
    const binding = await this.bindings.deleteLatestForWallet(walletAddress);

    await this.audit.record({
      eventType: binding ? "telegram.binding.removed" : "telegram.binding.remove.skipped",
      status: binding ? "succeeded" : "skipped",
      metadata: {
        walletAddress,
        ...(binding ? { chatId: binding.chatId } : { reason: "binding_not_found" })
      }
    });

    return binding;
  }

  public async sendRiskAlert(riskSnapshot: RiskSnapshotRecord): Promise<AlertRecord | undefined> {
    if (riskSnapshot.status !== "succeeded" || !riskSnapshot.threshold.exceeded) {
      return undefined;
    }

    const binding = await this.bindings.latestForWallet(riskSnapshot.walletAddress);

    if (!binding) {
      await this.audit.record({
        eventType: "telegram.alert.skipped",
        status: "skipped",
        metadata: {
          walletAddress: riskSnapshot.walletAddress,
          riskSnapshotId: riskSnapshot.riskSnapshotId,
          reason: "missing_binding"
        }
      });
      return undefined;
    }

    const health = await this.telegram.health();
    if (!health.ok) {
      await this.audit.record({
        eventType: "telegram.alert.skipped",
        status: "skipped",
        metadata: {
          walletAddress: riskSnapshot.walletAddress,
          riskSnapshotId: riskSnapshot.riskSnapshotId,
          reason: health.reason ?? "telegram_unhealthy"
        }
      });
      return undefined;
    }

    const alertId = randomUUID();
    const message = this.formatRiskAlertMessage(riskSnapshot);

    try {
      const buttons = await this.buildAlertButtons(binding, alertId, riskSnapshot.walletAddress);
      const sent = await this.telegram.sendMessage({
        chatId: binding.chatId,
        text: message,
        buttons
      });

      const alert = await this.alerts.append({
        alertId,
        userId: binding.userId,
        walletAddress: binding.walletAddress,
        chatId: binding.chatId,
        riskSnapshotId: riskSnapshot.riskSnapshotId,
        status: "sent",
        severity: severityForScore(riskSnapshot.score),
        score: riskSnapshot.score,
        explanation: riskSnapshot.explanation,
        message,
        ...(sent.messageId ? { telegramMessageId: sent.messageId } : {})
      });

      await this.audit.record({
        eventType: "telegram.alert.sent",
        status: "succeeded",
        metadata: {
          alertId: alert.alertId,
          userId: alert.userId,
          walletAddress: alert.walletAddress,
          riskSnapshotId: alert.riskSnapshotId,
          score: alert.score,
          severity: alert.severity
        }
      });

      return alert;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "telegram send failed";
      const alert = await this.alerts.append({
        alertId,
        userId: binding.userId,
        walletAddress: binding.walletAddress,
        chatId: binding.chatId,
        riskSnapshotId: riskSnapshot.riskSnapshotId,
        status: "failed",
        severity: severityForScore(riskSnapshot.score),
        score: riskSnapshot.score,
        explanation: riskSnapshot.explanation,
        message,
        failureReason: reason
      });

      await this.audit.record({
        eventType: "telegram.alert.failed",
        status: "failed",
        metadata: {
          alertId: alert.alertId,
          walletAddress: alert.walletAddress,
          riskSnapshotId: alert.riskSnapshotId,
          reason
        }
      });

      return alert;
    }
  }

  public async processCallback(input: TelegramCallbackRequest): Promise<TelegramCallbackResult> {
    const parsed = telegramCallbackRequestSchema.parse(input);
    let callback: ReturnType<typeof verifyCompactTelegramCallbackData>;

    try {
      callback = verifyCompactTelegramCallbackData(parsed.data, this.callbackSecret());
    } catch (error) {
      return this.rejectCallback("telegram.callback.rejected", {
        reason: error instanceof Error ? error.message : "invalid_callback"
      });
    }

    const callbackRecord = await this.nonces.findByNonce(callback.nonce);
    if (!callbackRecord) {
      return this.rejectCallback("telegram.callback.rejected", {
        reason: "unknown_nonce"
      });
    }

    if (callbackRecord.chatId !== parsed.chatId) {
      return this.rejectCallback("telegram.callback.rejected", {
        userId: callbackRecord.userId,
        reason: "wrong_chat"
      });
    }

    const binding = await this.bindings.findByUserAndChat(
      callbackRecord.userId,
      callbackRecord.chatId
    );
    if (!binding || (binding.telegramUserId && binding.telegramUserId !== parsed.telegramUserId)) {
      return this.rejectCallback("telegram.callback.rejected", {
        userId: callbackRecord.userId,
        reason: "unauthorized_binding"
      });
    }

    const nonce = await this.nonces.consumeOnce({
      actionNonce: callbackRecord.actionNonce,
      userId: callbackRecord.userId,
      actionType: callbackRecord.actionType
    });

    if (!nonce.ok) {
      return this.rejectCallback("telegram.callback.rejected", {
        userId: callbackRecord.userId,
        reason: nonce.reason ?? "invalid_nonce"
      });
    }

    if (callbackRecord.actionType === "acknowledge_alert") {
      return this.acknowledgeAlert(
        callbackRecord.alertId,
        binding.chatId,
        callbackRecord.userId
      );
    }

    if (callbackRecord.actionType === "refresh_analysis") {
      return this.refreshAnalysis(
        binding.walletAddress,
        binding.chatId,
        callbackRecord.userId
      );
    }

    if (callbackRecord.actionType === "approve_riskguard_tx") {
      return this.approveRiskGuardTx(callbackRecord, binding.chatId);
    }

    if (callbackRecord.actionType === "decline_riskguard_tx") {
      return this.declineRiskGuardTx(callbackRecord, binding.chatId);
    }

    return this.approveSafeAction(callbackRecord.safeAction, callbackRecord.userId);
  }

  private async buildRiskGuardButtons(
    binding: { userId: string; chatId: string; walletAddress: string },
    smartAccountAddress: string,
    txHash: string
  ) {
    return [
      {
        text: "Approve",
        callbackData: await this.createCallbackData({
          actionType: "approve_riskguard_tx",
          userId: binding.userId,
          chatId: binding.chatId,
          walletAddress: binding.walletAddress,
          smartAccountAddress,
          txHash
        })
      },
      {
        text: "Decline",
        callbackData: await this.createCallbackData({
          actionType: "decline_riskguard_tx",
          userId: binding.userId,
          chatId: binding.chatId,
          walletAddress: binding.walletAddress,
          smartAccountAddress,
          txHash
        })
      }
    ];
  }

  private async buildAlertButtons(
    binding: { userId: string; chatId: string },
    alertId: string,
    walletAddress: string
  ) {
    return [
      {
        text: "Acknowledge",
        callbackData: await this.createCallbackData({
          actionType: "acknowledge_alert",
          userId: binding.userId,
          chatId: binding.chatId,
          alertId
        })
      },
      {
        text: "Refresh Analysis",
        callbackData: await this.createCallbackData({
          actionType: "refresh_analysis",
          userId: binding.userId,
          chatId: binding.chatId,
          walletAddress
        })
      },
      {
        text: "Approve Safe Action",
        callbackData: await this.createCallbackData({
          actionType: "approve_safe_action",
          userId: binding.userId,
          chatId: binding.chatId,
          walletAddress,
          safeAction: "claim_small_reward"
        })
      }
    ];
  }

  private async createCallbackData(input: {
    actionType: TelegramActionType;
    userId: string;
    chatId: string;
    alertId?: string;
    walletAddress?: string;
    smartAccountAddress?: string;
    txHash?: string;
    safeAction?: string;
  }): Promise<string> {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const nonce = await this.nonces.create({
      userId: input.userId,
      actionType: input.actionType,
      chatId: input.chatId,
      expiresAt,
      ...(input.alertId ? { alertId: input.alertId } : {}),
      ...(input.walletAddress ? { walletAddress: input.walletAddress } : {}),
      ...(input.smartAccountAddress ? { smartAccountAddress: input.smartAccountAddress } : {}),
      ...(input.txHash ? { txHash: input.txHash } : {}),
      ...(input.safeAction ? { safeAction: input.safeAction } : {})
    });

    return createCompactTelegramCallbackData(nonce.actionNonce, this.callbackSecret());
  }

  private formatRiskAlertMessage(riskSnapshot: RiskSnapshotRecord): string {
    const severity = severityForScore(riskSnapshot.score);
    return [
      "Somnia RiskGuard Alert",
      `Risk Score: ${riskSnapshot.score}/100`,
      `Severity: ${severity}`,
      `Reason: ${summarizeReason(riskSnapshot.explanation)}`,
      "This is informational analysis, not financial advice."
    ].join("\n");
  }

  private formatRiskGuardApprovalMessage(input: RiskGuardPendingApprovalRequest): string {
    return [
      "RiskGuard Transaction Review",
      `Smart Account: ${formatAddress(input.smartAccountAddress)}`,
      `Tx Hash: ${formatAddress(input.txHash)}`,
      input.target ? `Target: ${formatAddress(input.target)}` : undefined,
      input.valueWei ? `Value: ${formatNativeValue(input.valueWei)}` : undefined,
      input.selector ? `Selector: ${input.selector}` : undefined,
      input.description ? `Transaction: ${summarizeReason(input.description)}` : undefined,
      "Manual fallback: Approve submits an on-chain one-time approval. Decline leaves the transaction blocked."
    ].filter(Boolean).join("\n");
  }

  private async acknowledgeAlert(
    alertId: string | undefined,
    chatId: string,
    userId: string
  ): Promise<TelegramCallbackResult> {
    if (!alertId) {
      return this.rejectCallback("telegram.callback.rejected", {
        userId,
        reason: "missing_alert"
      });
    }

    const alert = await this.alerts.findById(alertId);
    if (!alert || alert.userId !== userId) {
      return this.rejectCallback("telegram.callback.rejected", {
        userId,
        alertId,
        reason: "alert_not_found"
      });
    }

    await this.alerts.acknowledge(alertId);
    await this.telegram.sendMessage({
      chatId,
      text: "Alert acknowledged. RiskGuard will keep monitoring."
    });
    await this.audit.record({
      eventType: "telegram.alert.acknowledged",
      status: "succeeded",
      metadata: { userId, alertId }
    });

    return { ok: true, message: "Alert acknowledged." };
  }

  private async refreshAnalysis(
    walletAddress: string,
    chatId: string,
    userId: string
  ): Promise<TelegramCallbackResult> {
    const latestPortfolio = await this.portfolios.latestForWallet(walletAddress);

    if (!latestPortfolio) {
      return this.rejectCallback("telegram.callback.rejected", {
        userId,
        walletAddress,
        reason: "missing_portfolio"
      });
    }

    try {
      const risk = await this.riskScore.analyze(latestPortfolio);
      await this.telegram.sendMessage({
        chatId,
        text: [
          "Refreshed Risk Analysis",
          `Risk Score: ${risk.score}/100`,
          `Severity: ${severityForScore(risk.score)}`,
          `Reason: ${summarizeReason(risk.explanation)}`
        ].join("\n")
      });

      await this.audit.record({
        eventType: "telegram.analysis.refreshed",
        status: "succeeded",
        metadata: { userId, walletAddress, riskSnapshotId: risk.riskSnapshotId }
      });

      return { ok: true, message: "Risk analysis refreshed." };
    } catch (error) {
      return this.rejectCallback("telegram.callback.rejected", {
        userId,
        walletAddress,
        reason: error instanceof Error ? error.message : "risk_refresh_failed"
      });
    }
  }

  private async approveSafeAction(
    safeAction: string | undefined,
    userId: string
  ): Promise<TelegramCallbackResult> {
    const decision = evaluateTelegramSafeActionApproval({
      safeAction: safeAction ?? "unknown",
      signerAddress: "0x0000000000000000000000000000000000000000",
      chainId: this.config.somnia.chainId
    });

    await this.audit.record({
      eventType: decision.allowed
        ? "telegram.policy.approved"
        : "telegram.policy.denied",
      status: decision.allowed ? "succeeded" : "denied",
      metadata: { userId, policyDecision: decision }
    });

    return {
      ok: decision.allowed,
      message: decision.allowed
        ? "Safe action approved for downstream policy checks."
        : "Unsupported action is outside MVP scope.",
      policyDecision: decision
    };
  }

  private async approveRiskGuardTx(
    callbackRecord: {
      userId: string;
      smartAccountAddress?: string | undefined;
      txHash?: string | undefined;
    },
    chatId: string
  ): Promise<TelegramCallbackResult> {
    if (!this.riskGuardApprovals || !callbackRecord.smartAccountAddress || !callbackRecord.txHash) {
      return this.rejectCallback("riskguard.approval.rejected", {
        userId: callbackRecord.userId,
        reason: "approval_service_not_configured"
      });
    }

    try {
      const receipt = await this.riskGuardApprovals.submitApproval({
        smartAccountAddress: callbackRecord.smartAccountAddress,
        txHash: callbackRecord.txHash
      });
      await this.telegram.sendMessage({
        chatId,
        text: [
          "RiskGuard approval submitted on-chain.",
          `Approval Tx: ${receipt.txHash}`,
          "Resubmit the original transaction now."
        ].join("\n")
      });

      return { ok: true, message: "RiskGuard approval submitted." };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "approval_failed";
      await this.audit.record({
        eventType: "riskguard.approval.failed",
        status: "failed",
        metadata: {
          userId: callbackRecord.userId,
          smartAccountAddress: callbackRecord.smartAccountAddress,
          txHash: callbackRecord.txHash,
          reason
        }
      });
      await this.telegram.sendMessage({
        chatId,
        text: `RiskGuard approval failed: ${reason}`
      });
      return { ok: false, message: "RiskGuard approval failed." };
    }
  }

  private async declineRiskGuardTx(
    callbackRecord: {
      userId: string;
      smartAccountAddress?: string | undefined;
      txHash?: string | undefined;
    },
    chatId: string
  ): Promise<TelegramCallbackResult> {
    await this.audit.record({
      eventType: "riskguard.approval.declined",
      status: "denied",
      metadata: {
        userId: callbackRecord.userId,
        smartAccountAddress: callbackRecord.smartAccountAddress,
        txHash: callbackRecord.txHash
      }
    });
    await this.telegram.sendMessage({
      chatId,
      text: "RiskGuard transaction declined. No on-chain approval was submitted."
    });

    return { ok: true, message: "RiskGuard transaction declined." };
  }

  private async rejectCallback(
    eventType: string,
    metadata: Record<string, unknown>
  ): Promise<TelegramCallbackResult> {
    await this.audit.record({
      eventType,
      status: "denied",
      metadata
    });

    return {
      ok: false,
      message: "Telegram action rejected."
    };
  }

  private callbackSecret(): string {
    const secret = this.config.telegram.webhookSecret ?? this.config.telegram.botToken;

    if (!secret) {
      throw new Error("Telegram callback secret is not configured");
    }

    return secret;
  }
}
