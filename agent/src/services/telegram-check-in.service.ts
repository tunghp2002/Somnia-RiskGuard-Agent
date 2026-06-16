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
import { Config } from "thirdweb/wallets/smart";
import { Contract, JsonRpcProvider } from "ethers";
import type { SessionKeyService } from "./session-key/index.js";
import {
  getSessionKeyActionTargets,
  toSessionKeyActionPermission,
  toThirdwebSessionKeyPermissions,
} from "./session-key/actions.js";

const riskGuardAccountSalt = "riskguard-v2-2026-06-01";

const inheritanceRegistryCheckInAbi = [
  {
    type: "function",
    name: "checkIn",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "error", name: "NoActivePlan", inputs: [] },
  { type: "error", name: "DeadManSwitchActive", inputs: [] },
  { type: "error", name: "NotSmartAccount", inputs: [] },
] as const;

const registryErrorSelectors = {
  "0xa562fe00": "NoActivePlan",
  "0x95ea8dfb": "DeadManSwitchActive",
  "0xaf9aa1e0": "NotSmartAccount",
} as const;

const registryErrorMessages = {
  NoActivePlan:
    "No active inheritance plan is configured for this smart account. Open RiskGuard settings, select this smart account, and create or approve a heartbeat plan before using /checkin.",
  NoActivePlanForWrongSender:
    "The linked smart account has an active plan, but the check-in transaction reached the registry from a different sender. Re-authorize Telegram check-in for this smart account, then retry /checkin.",
  DeadManSwitchActive:
    "The heartbeat grace period has already expired, so check-in is no longer available for this plan.",
  NotSmartAccount:
    "The check-in was not executed from the linked smart account. Reconnect Telegram after selecting your smart account, then authorize Telegram check-in again.",
} as const;

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

    let linkedSmartAccountHasActivePlan: boolean | undefined;

    try {
      linkedSmartAccountHasActivePlan =
        await this.hasActivePlan(smartAccount);
      if (!linkedSmartAccountHasActivePlan) {
        throw new Error(registryErrorMessages.NoActivePlan);
      }

      const { record, privateKey } =
        await this.sessionKeys.getPrivateKeyForSmartAccount(
          smartAccount,
          "checkin",
        );
      const receipt = await this.submitCheckInUserOperation(
        smartAccount,
        record.walletAddress,
        record.sessionKeyAddress,
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
      const reason = formatCheckInError(error, {
        ...(linkedSmartAccountHasActivePlan === undefined
          ? {}
          : { linkedSmartAccountHasActivePlan }),
      });
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

  private async hasActivePlan(smartAccountAddress: string) {
    const registryAddress =
      this.config.publicChain.contracts.inheritanceRegistry;

    if (!registryAddress) {
      throw new Error(
        "Inheritance Registry is not deployed/configured for this chain yet.",
      );
    }

    const provider = new JsonRpcProvider(
      this.config.publicChain.rpcUrl,
      this.config.publicChain.chainId,
    );
    const registry = new Contract(
      registryAddress,
      [
        "function getPlan(address smartAccount) view returns ((address smartAccount,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod,uint256 lastHeartbeatAt,uint256 createdAt,uint256 updatedAt,uint256 executedAt,uint8 state),(address addr,uint256 shareBps)[],(address token)[])",
      ],
      provider,
    );
    const [plan] = (await registry.getFunction("getPlan")(
      smartAccountAddress,
    )) as [
      { state: bigint | number },
      unknown[],
      unknown[],
    ];

    return BigInt(plan.state) === 1n;
  }

  private async submitCheckInUserOperation(
    smartAccountAddress: string,
    walletAddress: string,
    sessionKeyAddress: string,
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

    const sessionKeyPermissions = toThirdwebSessionKeyPermissions(
      toSessionKeyActionPermission({
        action: "checkin",
        walletAddress,
        smartAccountAddress,
        sessionKeyAddress,
        approvedTargets: getSessionKeyActionTargets({
          action: "checkin",
          inheritanceRegistryAddress: registryAddress,
        }),
      }),
    );

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
    const factoryAddress =
      this.config.publicChain.contracts.riskGuardModularAccountFactory;
    const validatorAddress =
      this.config.publicChain.contracts.riskGuardValidatorModule ??
      this.config.publicChain.contracts.riskGuardDefaultValidator;

    if (!factoryAddress || !validatorAddress) {
      throw new Error(
        "ERC-7579 modular account factory and validator are not configured for this chain.",
      );
    }

    const connectAccount = async (sponsorGas: boolean) => {
      const accountWallet = smartWallet(Config.erc7579({
        chain,
        factoryAddress,
        sponsorGas,
        sessionKey: {
          address: sessionKeyAddress,
          permissions: sessionKeyPermissions,
        },
        validatorAddress,
        overrides: {
          accountSalt: riskGuardAccountSalt,
          accountAddress: smartAccountAddress,
        },
      }));

      return accountWallet.connect({
        client,
        personalAccount: sessionKeyAccount,
      });
    };

    let account = await connectAccount(true);

    if (account.address.toLowerCase() !== smartAccountAddress.toLowerCase()) {
      throw new Error(
        `Telegram check-in resolved smart account ${formatWallet(account.address)} but expected ${formatWallet(smartAccountAddress)}. Re-authorize Telegram check-in from the selected smart account.`,
      );
    }

    const registry = getContract({
      address: registryAddress,
      abi: inheritanceRegistryCheckInAbi,
      chain,
      client,
    });
    const transaction = prepareContractCall({
      contract: registry,
      method: "checkIn",
      params: [],
    });

    try {
      return await sendAndConfirmTransaction({
        account,
        transaction,
      });
    } catch (error) {
      if (!isPaymasterServerError(error)) {
        throw error;
      }

      account = await connectAccount(false);
      return sendAndConfirmTransaction({
        account,
        transaction,
      });
    }
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

export function formatCheckInError(
  error: unknown,
  context: { linkedSmartAccountHasActivePlan?: boolean } = {},
) {
  const message =
    error instanceof Error ? error.message : "check-in transaction failed";

  const registryError = getRegistryErrorName(message);
  if (registryError) {
    if (
      registryError === "NoActivePlan" &&
      context.linkedSmartAccountHasActivePlan
    ) {
      return registryErrorMessages.NoActivePlanForWrongSender;
    }

    return registryErrorMessages[registryError];
  }

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

export function isPaymasterServerError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "");

  return (
    /paymaster/i.test(message) &&
    (
      /\b500\b/.test(message) ||
      /internal server error/i.test(message)
    )
  );
}

function getRegistryErrorName(
  message: string,
): keyof typeof registryErrorMessages | undefined {
  for (const errorName of Object.keys(
    registryErrorMessages,
  ) as Array<keyof typeof registryErrorMessages>) {
    if (message.includes(`${errorName}()`) || message.includes(errorName)) {
      return errorName;
    }
  }

  const selector = message
    .match(/Encoded error signature "(0x[a-fA-F0-9]{8})"/)?.[1]
    ?.toLowerCase() as keyof typeof registryErrorSelectors | undefined;

  return selector ? registryErrorSelectors[selector] : undefined;
}
