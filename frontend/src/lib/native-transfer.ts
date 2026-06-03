import {
  BrowserProvider,
  Contract,
  Interface,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  solidityPacked
} from "ethers";
import { estimateGasCost, prepareTransaction, sendAndConfirmTransaction } from "thirdweb";
import { agentApi } from "@/lib/agent-api";
import { somniaThirdwebChain, thirdwebClient } from "@/lib/thirdweb-client";

import type { NativeTransferEstimate, NativeTransferInput } from "@/features/dashboard/types";
import type { Account } from "thirdweb/wallets";

const nativeDecimals = 18;
const smartTransferGasLimit = 31_000_000n;
const riskGuardValidatorInterface = new Interface([
  "error AgentBudgetInsufficient()",
  "error AgentNotConfigured()",
  "error AgentRequestPending()",
  "error AgentReviewPending(address smartAccount, bytes32 txHash, uint256 requestId)",
  "error PendingApprovalRequired(address smartAccount, bytes32 txHash, address signer, bytes riskContext)",
  "function AGENT_SUBCOMMITTEE_SIZE() view returns (uint256)",
  "function agentBudgetOf(address smartAccount) view returns (uint256)",
  "function agentPlatform() view returns (address)",
  "function fundAgentBudget(address smartAccount) payable",
  "function requestAgentReview(address smartAccount, bytes callData) returns (uint256 requestId)",
  "function riskAgentRewardPerCall() view returns (uint256)"
]);
const agentRequesterInterface = new Interface([
  "function getRequestDeposit() view returns (uint256)"
]);
const erc7579AccountInterface = new Interface([
  "function execute(bytes32 mode, bytes executionCalldata)"
]);

type TransferValidationContext = {
  eoaAddress: string | undefined;
  smartAccountAddress: string | undefined;
};

export function getNativeTransferValidationError(
  input: NativeTransferInput,
  context: TransferValidationContext
) {
  const sourceAddress = input.source === "eoa" ? context.eoaAddress : context.smartAccountAddress;

  if (!sourceAddress) {
    return input.source === "eoa"
      ? "Connect an EOA wallet before sending."
      : "Connect or create a Thirdweb smart account before sending.";
  }

  const recipient = input.recipient.trim();
  if (!recipient) {
    return "Enter a recipient address.";
  }

  if (!isAddress(recipient)) {
    return "Recipient must be a valid EVM address.";
  }

  if (getAddress(recipient) === getAddress(sourceAddress)) {
    return "Recipient cannot be the same as the sending account.";
  }

  const amount = input.amount.trim();
  if (!amount) {
    return "Enter an amount.";
  }

  try {
    const parsed = parseUnits(amount, nativeDecimals);
    if (parsed <= 0n) {
      return "Amount must be greater than zero.";
    }
  } catch {
    return "Amount must be a valid native token amount.";
  }

  return null;
}

function getEthereumProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No browser wallet detected.");
  }

  return window.ethereum;
}

function formatNative(value: bigint, symbol: string) {
  const formatted = formatUnits(value, nativeDecimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");

  return `${whole}${trimmedFraction ? `.${trimmedFraction}` : ""} ${symbol}`;
}

function buildThirdwebTransferTransaction(recipient: string, amountWei: bigint) {
  if (!thirdwebClient) {
    throw new Error("Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID before sending from a smart account.");
  }

  return prepareTransaction({
    chain: somniaThirdwebChain,
    client: thirdwebClient,
    gas: smartTransferGasLimit,
    to: getAddress(recipient),
    value: amountWei
  });
}

function extractRiskGuardPendingApproval(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const candidates = message.match(/0x[a-fA-F0-9]{8,}/g) ?? [];

  for (const candidate of candidates.sort((left, right) => right.length - left.length)) {
    try {
      const parsed = riskGuardValidatorInterface.parseError(candidate);
      if (parsed?.name === "PendingApprovalRequired") {
        return {
          smartAccountAddress: getAddress(parsed.args.smartAccount as string),
          txHash: parsed.args.txHash as string
        };
      }
    } catch {
      // Keep scanning: wallet SDKs wrap revert data differently across transports.
    }
  }

  return undefined;
}

function extractRiskGuardErrorName(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const candidates = message.match(/0x[a-fA-F0-9]{8,}/g) ?? [];

  for (const candidate of candidates.sort((left, right) => right.length - left.length)) {
    try {
      return riskGuardValidatorInterface.parseError(candidate)?.name;
    } catch {
      // Keep scanning wrapped revert payloads.
    }
  }

  return undefined;
}

function buildNativeTransferUserOpCallData(recipient: string, amountWei: bigint) {
  const singleExecutionMode = `0x${"00".repeat(32)}`;
  const executionCalldata = solidityPacked(
    ["address", "uint256", "bytes"],
    [getAddress(recipient), amountWei, "0x"]
  );

  return erc7579AccountInterface.encodeFunctionData("execute", [
    singleExecutionMode,
    executionCalldata
  ]);
}

async function requestSomniaAgentReviewForTransfer(options: {
  amountWei: bigint;
  recipient: string;
  riskGuardValidatorAddress: string;
  smartAccountAddress: string;
}) {
  const provider = new BrowserProvider(getEthereumProvider());
  const signer = await provider.getSigner();
  const validator = new Contract(
    options.riskGuardValidatorAddress,
    riskGuardValidatorInterface,
    signer
  );
  const agentPlatform = getAddress(await validator.getFunction("agentPlatform").staticCall());

  if (agentPlatform === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error("Somnia RiskGuard agent is not configured on the validator contract.");
  }

  const platform = new Contract(agentPlatform, agentRequesterInterface, provider);
  const [requestDeposit, rewardPerCall, subcommitteeSize, currentBudget] = await Promise.all([
    platform.getFunction("getRequestDeposit").staticCall(),
    validator.getFunction("riskAgentRewardPerCall").staticCall(),
    validator.getFunction("AGENT_SUBCOMMITTEE_SIZE").staticCall(),
    validator.getFunction("agentBudgetOf").staticCall(options.smartAccountAddress)
  ]) as [bigint, bigint, bigint, bigint];
  const requiredBudget = requestDeposit + (rewardPerCall * subcommitteeSize);

  if (currentBudget < requiredBudget) {
    const fundTx = await validator.getFunction("fundAgentBudget")(
      options.smartAccountAddress,
      { value: requiredBudget - currentBudget }
    );
    await fundTx.wait();
  }

  const callData = buildNativeTransferUserOpCallData(options.recipient, options.amountWei);
  const requestTx = await validator.getFunction("requestAgentReview")(
    options.smartAccountAddress,
    callData
  );
  const receipt = await requestTx.wait();

  return receipt?.hash ?? requestTx.hash;
}

export async function estimateNativeTransfer(
  input: NativeTransferInput,
  context: TransferValidationContext & {
    smartAccount: Account | undefined;
    symbol: string;
  }
): Promise<NativeTransferEstimate> {
  const validationError = getNativeTransferValidationError(input, context);
  if (validationError) {
    throw new Error(validationError);
  }

  const sourceAddress = input.source === "eoa" ? context.eoaAddress : context.smartAccountAddress;
  if (!sourceAddress) {
    throw new Error("Source account is not available.");
  }

  const provider = new BrowserProvider(getEthereumProvider());
  const amountWei = parseUnits(input.amount.trim(), nativeDecimals);
  const recipient = getAddress(input.recipient.trim());
  const balanceWei = await provider.getBalance(sourceAddress);
  let gasWei: bigint;

  if (input.source === "eoa") {
    const feeData = await provider.getFeeData();
    const gasLimit = await provider.estimateGas({
      from: sourceAddress,
      to: recipient,
      value: amountWei
    });
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (!gasPrice) {
      throw new Error("Unable to estimate network fee.");
    }
    gasWei = gasLimit * gasPrice;
  } else {
    if (!context.smartAccount) {
      throw new Error("Connect or create a Thirdweb smart account before estimating.");
    }

    const transaction = buildThirdwebTransferTransaction(recipient, amountWei);
    const estimate = await estimateGasCost({
      account: context.smartAccount,
      transaction
    });
    gasWei = estimate.wei;
  }

  const totalWei = amountWei + gasWei;
  if (balanceWei < amountWei) {
    throw new Error(`Insufficient balance. Available: ${formatNative(balanceWei, context.symbol)}.`);
  }

  if (input.source === "eoa" && balanceWei < totalWei) {
    throw new Error(`Insufficient balance for amount plus fee. Required: ${formatNative(totalWei, context.symbol)}.`);
  }

  return {
    amountWei: amountWei.toString(),
    balanceWei: balanceWei.toString(),
    gasLabel: formatNative(gasWei, context.symbol),
    gasToken: context.symbol,
    gasWei: gasWei.toString(),
    sourceAddress,
    totalLabel: formatNative(totalWei, context.symbol),
    totalWei: totalWei.toString()
  };
}

export async function sendNativeTransferFromEoa(input: NativeTransferInput) {
  const provider = new BrowserProvider(getEthereumProvider());
  const signer = await provider.getSigner();
  const tx = await signer.sendTransaction({
    to: getAddress(input.recipient.trim()),
    value: parseUnits(input.amount.trim(), nativeDecimals)
  });
  await tx.wait();

  return tx.hash;
}

export async function sendNativeTransferFromSmartAccount(
  input: NativeTransferInput,
  account: Account,
  options: {
    riskGuardValidatorAddress?: string;
    walletAddress?: string;
  } = {}
) {
  const transaction = buildThirdwebTransferTransaction(
    input.recipient.trim(),
    parseUnits(input.amount.trim(), nativeDecimals)
  );
  let receipt: Awaited<ReturnType<typeof sendAndConfirmTransaction>>;

  try {
    receipt = await sendAndConfirmTransaction({
      account,
      transaction
    });
  } catch (error) {
    const pendingApproval = extractRiskGuardPendingApproval(error);
    if (pendingApproval) {
      const recipient = getAddress(input.recipient.trim());
      const amountWei = parseUnits(input.amount.trim(), nativeDecimals);

      if (!options.riskGuardValidatorAddress) {
        throw new Error("RiskGuard requires Somnia Agent review, but the validator contract is not configured in public chain metadata.");
      }

      const reviewTxHash = await requestSomniaAgentReviewForTransfer({
        amountWei,
        recipient,
        riskGuardValidatorAddress: options.riskGuardValidatorAddress,
        smartAccountAddress: pendingApproval.smartAccountAddress
      }).catch((reviewError: unknown) => {
        const riskGuardError = extractRiskGuardErrorName(reviewError);
        const message =
          riskGuardError === "AgentNotConfigured"
            ? "Somnia RiskGuard agent is not configured on the validator contract."
            : riskGuardError === "AgentBudgetInsufficient"
              ? "Somnia RiskGuard agent budget is insufficient."
              : riskGuardError === "AgentRequestPending" || riskGuardError === "AgentReviewPending"
                ? "A Somnia RiskGuard agent review is already pending for this smart account."
                : reviewError instanceof Error
                  ? reviewError.message
                  : String(reviewError);

        throw new Error(`RiskGuard requires Somnia Agent review, but requesting the review failed: ${message}`);
      });

      if (options.walletAddress) {
        await agentApi.notifyRiskGuardAgentReviewRequested({
          walletAddress: options.walletAddress,
          smartAccountAddress: pendingApproval.smartAccountAddress,
          guardedTxHash: pendingApproval.txHash,
          requestTxHash: reviewTxHash
        }).catch(() => undefined);
      }

      throw new Error(
        `Somnia Agent review requested on-chain (${reviewTxHash}). Wait for the agent callback, then send the same transaction again.`
      );
    }
    throw error;
  }

  return receipt.transactionHash;
}
