import type { AgentConfig } from "../config/env.js";
import type { TelegramBindingsRepository } from "../persistence/telegram-bindings.repository.js";
import type { AuditService } from "./audit.service.js";
import { createThirdwebClient, defineChain, getContract, prepareContractCall, sendAndConfirmTransaction } from "thirdweb";
import { privateKeyToAccount, smartWallet } from "thirdweb/wallets";
import type { SessionKeyService } from "./session-key.service.js";

export class TelegramCheckInService {
  public constructor(
    private readonly config: AgentConfig,
    private readonly bindings: TelegramBindingsRepository,
    private readonly sessionKeys: SessionKeyService,
    private readonly audit?: AuditService
  ) {}

  public async handleText(input: {
    text: string;
    chatId: string;
    telegramUserId?: string;
  }): Promise<{ ok: boolean; message: string }> {
    if (!/^\/checkin(?:@\w+)?$/i.test(input.text.trim())) {
      return { ok: false, message: "Unknown command." };
    }

    const binding = await this.bindings.latestForChat(input.chatId, input.telegramUserId);
    if (!binding) {
      return {
        ok: false,
        message: "Connect Telegram from the RiskGuard dashboard before using /checkin."
      };
    }

    const smartAccount = binding.smartAccountAddress;
    if (!smartAccount) {
      return {
        ok: false,
        message: "No smart account is linked to this Telegram chat yet. Reconnect Telegram after selecting your smart account."
      };
    }

    try {
      const { record, privateKey } = await this.sessionKeys.getPrivateKeyForSmartAccount(smartAccount, "checkin");
      const receipt = await this.submitCheckInUserOperation(smartAccount, privateKey);
      await this.sessionKeys.markUsed(record.sessionKeyId);

      await this.audit?.record({
        eventType: "telegram.checkin.submitted",
        status: "succeeded",
        metadata: {
          walletAddress: binding.walletAddress,
          smartAccountAddress: smartAccount,
          txHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber
        }
      });

      return {
        ok: true,
        message: `Check-in transaction submitted for ${formatWallet(smartAccount)}: ${formatTx(receipt.transactionHash)}`
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "check-in transaction failed";
      await this.audit?.record({
        eventType: "telegram.checkin.failed",
        status: "failed",
        metadata: {
          walletAddress: binding.walletAddress,
          smartAccountAddress: smartAccount,
          reason
        }
      });

      return {
        ok: false,
        message: `Check-in failed for ${formatWallet(smartAccount)}: ${reason}`
      };
    }
  }

  private async submitCheckInUserOperation(smartAccountAddress: string, privateKey: string) {
    const clientSecret = this.config.thirdweb.secretKey ?? this.config.thirdweb.clientId;
    const registryAddress = this.config.publicChain.contracts.inheritanceRegistry;

    if (!clientSecret) {
      throw new Error("THIRDWEB_SECRET_KEY or THIRDWEB_CLIENT_ID is required for Telegram check-in.");
    }

    if (!registryAddress) {
      throw new Error("Inheritance Registry is not deployed/configured for this chain yet.");
    }

    const client = this.config.thirdweb.secretKey
      ? createThirdwebClient({ secretKey: this.config.thirdweb.secretKey })
      : createThirdwebClient({ clientId: clientSecret });
    const chain = defineChain({
      id: this.config.publicChain.chainId,
      name: this.config.publicChain.name,
      nativeCurrency: this.config.publicChain.nativeCurrency,
      rpc: this.config.publicChain.rpcUrl,
      blockExplorers: [
        {
          name: "Somnia Explorer",
          url: this.config.publicChain.blockExplorerUrl
        }
      ],
      testnet: true
    });
    const sessionKeyAccount = privateKeyToAccount({ client, privateKey });

    const accountWallet = smartWallet({
      chain,
      sponsorGas: true,
      overrides: {
        accountAddress: smartAccountAddress
      }
    });
    const account = await accountWallet.connect({
      client,
      personalAccount: sessionKeyAccount
    });
    const registry = getContract({
      address: registryAddress,
      chain,
      client
    });
    const transaction = prepareContractCall({
      contract: registry,
      method: "function checkIn()",
      params: []
    });

    return sendAndConfirmTransaction({
      account,
      transaction
    });
  }
}

function formatWallet(walletAddress: string) {
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

function formatTx(txHash: string) {
  return `${txHash.slice(0, 6)}...${txHash.slice(-4)}`;
}
