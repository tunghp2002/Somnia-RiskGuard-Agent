import type { AgentConfig } from "../config/env.js";
import type { TelegramBindingsRepository } from "../persistence/telegram-bindings.repository.js";
import type { AuditService } from "./audit.service.js";
import {
  createThirdwebClient,
  defineChain,
  getContract,
  prepareContractCall,
  sendAndConfirmTransaction,
} from "thirdweb";
import { privateKeyToAccount, smartWallet } from "thirdweb/wallets";
import type { SessionKeyService } from "./session-key.service.js";

export class TelegramCheckInService {
  public constructor(
    private readonly config: AgentConfig,
    private readonly bindings: TelegramBindingsRepository,
    private readonly sessionKeys: SessionKeyService,
    private readonly audit?: AuditService,
  ) {}

  public async handleText(input: {
    text: string;
    chatId: string;
    telegramUserId?: string;
  }): Promise<{ ok: boolean; message: string }> {
    if (!/^\/checkin(?:@\w+)?$/i.test(input.text.trim())) {
      return { ok: false, message: "Unknown command." };
    }

    const binding = await this.bindings.latestForChat(
      input.chatId,
      input.telegramUserId,
    );
    if (!binding) {
      return {
        ok: false,
        message:
          "Connect Telegram from the RiskGuard dashboard before using /checkin.",
      };
    }

    const smartAccount = binding.smartAccountAddress;
    if (!smartAccount) {
      return {
        ok: false,
        message:
          "No smart account is linked to this Telegram chat yet. Reconnect Telegram after selecting your smart account.",
      };
    }

    try {
      const { record, privateKey } =
        await this.sessionKeys.getPrivateKeyForSmartAccount(
          smartAccount,
          "checkin",
        );
      const receipt = await this.submitCheckInUserOperation(
        smartAccount,
        privateKey,
      );
      await this.sessionKeys.markUsed(record.sessionKeyId);

      await this.audit?.record({
        eventType: "telegram.checkin.submitted",
        status: "succeeded",
        metadata: {
          walletAddress: binding.walletAddress,
          smartAccountAddress: smartAccount,
          txHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
        },
      });

      return {
        ok: true,
        message: [
          `Check-in transaction submitted`,
          `Transaction: ${formatTxLink(this.config.publicChain.blockExplorerUrl, receipt.transactionHash)}`,
        ].join("\n"),
      };
    } catch (error) {
      const reason = formatCheckInError(error);
      await this.audit?.record({
        eventType: "telegram.checkin.failed",
        status: "failed",
        metadata: {
          walletAddress: binding.walletAddress,
          smartAccountAddress: smartAccount,
          reason,
        },
      });

      return {
        ok: false,
        message: `Check-in failed for ${formatWallet(smartAccount)}: ${reason}`,
      };
    }
  }

  private async submitCheckInUserOperation(
    smartAccountAddress: string,
    privateKey: string,
  ) {
    const registryAddress =
      this.config.publicChain.contracts.inheritanceRegistry;

    if (!this.config.thirdweb.secretKey) {
      throw new Error("THIRDWEB_SECRET_KEY is required for Telegram check-in.");
    }

    if (!registryAddress) {
      throw new Error(
        "Inheritance Registry is not deployed/configured for this chain yet.",
      );
    }

    const client = createThirdwebClient({
      secretKey: this.config.thirdweb.secretKey,
    });
    const chain = defineChain({
      id: this.config.publicChain.chainId,
      name: this.config.publicChain.name,
      nativeCurrency: this.config.publicChain.nativeCurrency,
      rpc: this.config.publicChain.rpcUrl,
      blockExplorers: [
        {
          name: "Somnia Explorer",
          url: this.config.publicChain.blockExplorerUrl,
        },
      ],
      testnet: true,
    });
    const sessionKeyAccount = privateKeyToAccount({ client, privateKey });

    const accountWallet = smartWallet({
      chain,
      sponsorGas: true,
      overrides: {
        accountAddress: smartAccountAddress,
      },
    });
    const account = await accountWallet.connect({
      client,
      personalAccount: sessionKeyAccount,
    });
    const registry = getContract({
      address: registryAddress,
      chain,
      client,
    });
    const transaction = prepareContractCall({
      contract: registry,
      method: "function checkIn()",
      params: [],
    });

    return sendAndConfirmTransaction({
      account,
      transaction,
    });
  }
}

function formatWallet(walletAddress: string) {
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

function formatTx(txHash: string) {
  return `${txHash.slice(0, 6)}...${txHash.slice(-4)}`;
}

function formatAddressLink(explorerUrl: string, address: string) {
  return `${formatWallet(address)} (${explorerUrl.replace(/\/$/, "")}/address/${address})`;
}

function formatTxLink(explorerUrl: string, txHash: string) {
  return `${formatTx(txHash)} (${explorerUrl.replace(/\/$/, "")}/tx/${txHash})`;
}

function formatCheckInError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "check-in transaction failed";

  if (
    message.includes("thirdweb_getUserOperationGasPrice") &&
    (message.includes("Status: 401") ||
      message.includes("UNAUTHORIZED") ||
      message.includes("keys are invalid"))
  ) {
    return [
      "Backend THIRDWEB_SECRET_KEY is invalid or not authorized for Account Abstraction.",
      "Create/copy a backend Secret Key from the Thirdweb dashboard, put it in .env as THIRDWEB_SECRET_KEY, then restart the agent.",
    ].join(" ");
  }

  return message;
}
