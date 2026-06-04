import { formatUnits, getAddress, verifyMessage } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../config/env.js";
import type { AlertsRepository } from "../persistence/alerts.repository.js";
import type { ActionNoncesRepository } from "../persistence/action-nonces.repository.js";
import type { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
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
    messageId: z.string().regex(/^\d+$/).optional(),
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

function summarizeReason(explanation: string): string {
  return explanation.length > 240 ? `${explanation.slice(0, 237)}...` : explanation;
}

function formatAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function stripAgentRecommendationPrefix(reason: string): string {
  return reason
    .replace(/^\s*APPROVE\s*:?\s*/i, "")
    .replace(/^\s*REJECT\s*:?\s*/i, "")
    .trim();
}

function summarizeRiskGuardApprovalFailure(reason: string): string {
  if (/account does not exist|insufficient funds|no STT for gas/i.test(reason)) {
    return "RiskGuard approval signer does not have enough STT for gas. Reconfigure Risk Policy Guard so the user smart account funds the approval signer, then request review again.";
  }

  if (/not registered/i.test(reason)) {
    return "RiskGuard approval signer is not registered for this smart account. Reconfigure Risk Policy Guard, then request review again.";
  }

  return reason.length > 240 ? `${reason.slice(0, 237)}...` : reason;
}

export class TelegramAlertService {
  public constructor(
    private readonly config: AgentConfig,
    private readonly users: UsersRepository,
    private readonly bindings: TelegramBindingsRepository,
    private readonly alerts: AlertsRepository,
    private readonly nonces: ActionNoncesRepository,
    private readonly portfolios: PortfolioSnapshotsRepository,
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

    const sent = await this.telegram.sendMessage({
      chatId: binding.chatId,
      text: [
        "<b>Somnia Agent review requested</b>",
        "Status: 🟡 Reviewing",
        `Smart Account: <code>${escapeHtml(parsed.smartAccountAddress)}</code>`,
        `Guarded Tx: ${this.txLink(parsed.guardedTxHash)}`,
        `Request Tx: ${this.txLink(parsed.requestTxHash)}`,
        "This status message will disappear after the Somnia callback finalizes."
      ].join("\n"),
      parseMode: "HTML"
    });

    await this.audit.record({
      eventType: "riskguard.agent-review.requested.telegram.sent",
      status: "succeeded",
      metadata: {
        walletAddress: parsed.walletAddress,
        smartAccountAddress: parsed.smartAccountAddress,
        guardedTxHash: parsed.guardedTxHash,
        requestTxHash: parsed.requestTxHash,
        telegramMessageId: sent.messageId,
        chatId: binding.chatId
      }
    });

    return { sent: true };
  }

  public async sendRiskGuardAgentReviewDecision(input: {
    walletAddress: string;
    smartAccountAddress: string;
    txHash: string;
    approved: boolean;
    reason: string;
  }) {
    const smartAccountAddress = getAddress(input.smartAccountAddress);
    const walletAddress = getAddress(input.walletAddress);
    const pending = await this.findPendingAgentReviewRequest(smartAccountAddress, input.txHash);

    if (pending?.chatId && pending.telegramMessageId && this.telegram.deleteMessage) {
      await this.telegram.deleteMessage({
        chatId: pending.chatId,
        messageId: pending.telegramMessageId
      }).catch(() => undefined);
    }

    const binding = await this.bindings.latestForSmartAccount(smartAccountAddress)
      ?? await this.bindings.latestForWallet(walletAddress);

    if (!binding) {
      throw new TelegramAlertServiceError(
        "telegram_binding_not_found",
        "No Telegram binding is connected for this smart account.",
        404
      );
    }

    const analysis = stripAgentRecommendationPrefix(input.reason)
      || "Somnia Agent did not return a detailed analysis.";
    const riskScore = input.approved ? "Low" : "High";
    const buttons = await this.buildRiskGuardButtons(binding, smartAccountAddress, input.txHash);

    const sent = await this.telegram.sendMessage({
      chatId: binding.chatId,
      text: [
        "<b>Somnia Agent RiskGuard Review</b>",
        `Status: ${input.approved ? "🟢 Agent recommends approval" : "🔴 Agent recommends rejection"}`,
        `Agent Recommendation: ${input.approved ? "Approve" : "Decline"}`,
        `Smart Account: <code>${escapeHtml(smartAccountAddress)}</code>`,
        `Guarded Tx: ${this.txLink(input.txHash)}`,
        pending?.requestTxHash ? `Request Tx: ${this.txLink(pending.requestTxHash)}` : undefined,
        `Risk Score: ${riskScore}`,
        `Analysis: ${escapeHtml(analysis)}`,
        "Advice: Choose Approve to submit a one-time approval and continue without another agent review. Choose Decline to reject execution."
      ].filter(Boolean).join("\n"),
      buttons,
      parseMode: "HTML"
    });

    await this.audit.record({
      eventType: "riskguard.agent-review.decision.telegram.sent",
      status: "succeeded",
      metadata: {
        walletAddress,
        smartAccountAddress,
        guardedTxHash: input.txHash,
        requestTxHash: pending?.requestTxHash,
        approved: input.approved,
        telegramMessageId: sent.messageId
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

    if (callbackRecord.actionType === "approve_riskguard_tx") {
      await this.clearCallbackButtons(parsed.chatId, parsed.messageId);
      return this.approveRiskGuardTx(callbackRecord, binding);
    }

    if (callbackRecord.actionType === "decline_riskguard_tx") {
      await this.clearCallbackButtons(parsed.chatId, parsed.messageId);
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

  private txLink(txHash: string): string {
    const explorer = this.config.publicChain.blockExplorerUrl.replace(/\/+$/, "");
    return `<a href="${escapeHtml(`${explorer}/tx/${txHash}`)}">${escapeHtml(formatAddress(txHash))}</a>`;
  }

  private async findPendingAgentReviewRequest(smartAccountAddress: string, txHash: string) {
    const events = await this.audit.list();
    const event = events
      .filter((item) => item.eventType === "riskguard.agent-review.requested.telegram.sent")
      .reverse()
      .find((item) =>
        String(item.metadata.smartAccountAddress).toLowerCase() === smartAccountAddress.toLowerCase()
        && String(item.metadata.guardedTxHash).toLowerCase() === txHash.toLowerCase()
      );

    if (!event) {
      return undefined;
    }

    return {
      chatId: typeof event.metadata.chatId === "string" ? event.metadata.chatId : undefined,
      telegramMessageId: typeof event.metadata.telegramMessageId === "string"
        ? event.metadata.telegramMessageId
        : undefined,
      requestTxHash: typeof event.metadata.requestTxHash === "string"
        ? event.metadata.requestTxHash
        : undefined
    };
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
    binding: { userId: string; chatId: string; walletAddress: string }
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
        chatId: binding.chatId,
        text: [
          "🟢 RiskGuard approval succeeded.",
          `Approval Tx: ${receipt.txHash}`,
          "The transaction now has a one-time approval and can continue without another Somnia Agent review."
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
        chatId: binding.chatId,
        text: `⚠️ RiskGuard approval failed: ${summarizeRiskGuardApprovalFailure(reason)}`
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
      text: "🔴 RiskGuard transaction rejected. No on-chain approval was submitted."
    });

    return { ok: true, message: "RiskGuard transaction declined." };
  }

  private async clearCallbackButtons(chatId: string, messageId: string | undefined) {
    if (!messageId || !this.telegram.editMessageReplyMarkup) {
      return;
    }

    await this.telegram.editMessageReplyMarkup({
      chatId,
      messageId,
      buttons: []
    }).catch(() => undefined);
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
