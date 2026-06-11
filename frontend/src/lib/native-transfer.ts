import {
  BrowserProvider,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
} from "ethers";
import { estimateGasCost, prepareTransaction } from "thirdweb";

import { sendRiskGuardedSmartTransaction } from "@/lib/riskguard-smart-account";
import { somniaThirdwebChain, thirdwebClient } from "@/lib/thirdweb-client";

import type { NativeTransferEstimate, NativeTransferInput } from "@/features/dashboard/types";
import type { Account } from "thirdweb/wallets";

const nativeDecimals = 18;
const smartTransferGasLimit = 31_000_000n;

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

function rawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNoDataRevert(error: unknown) {
  const message = rawErrorMessage(error);

  return (
    /execution reverted|CALL_EXCEPTION|require\(false\)|estimateGas/i.test(message) &&
    (/data\s*=\s*"0x"/i.test(message) || /"data"\s*:\s*"0x"/i.test(message) || /data:\s*0x/i.test(message))
  );
}

function isUserRejected(error: unknown) {
  return /user rejected|user denied|rejected the request|action_rejected/i.test(rawErrorMessage(error));
}

function normalizeNativeTransferError(
  error: unknown,
  {
    phase,
    source,
    symbol,
  }: {
    phase: "estimate" | "send";
    source: NativeTransferInput["source"];
    symbol: string;
  },
) {
  if (isUserRejected(error)) {
    return "Transaction was rejected in your wallet.";
  }

  if (isNoDataRevert(error)) {
    if (source === "eoa") {
      return `Recipient contract rejected this native ${symbol} transfer. Use an EOA recipient or a contract that accepts native tokens.`;
    }

    return `Smart account transfer was rejected during ${phase === "estimate" ? "fee estimation" : "submission"}. Check the recipient, amount, and RiskGuard policy before trying again.`;
  }

  return rawErrorMessage(error);
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
    const gasLimit = await provider
      .estimateGas({
        from: sourceAddress,
        to: recipient,
        value: amountWei
      })
      .catch((error: unknown) => {
        throw new Error(normalizeNativeTransferError(error, {
          phase: "estimate",
          source: input.source,
          symbol: context.symbol,
        }));
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
    }).catch((error: unknown) => {
      throw new Error(normalizeNativeTransferError(error, {
        phase: "estimate",
        source: input.source,
        symbol: context.symbol,
      }));
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

export async function sendNativeTransferFromEoa(input: NativeTransferInput, symbol = "native token") {
  const provider = new BrowserProvider(getEthereumProvider());
  const signer = await provider.getSigner();
  const tx = await signer
    .sendTransaction({
      to: getAddress(input.recipient.trim()),
      value: parseUnits(input.amount.trim(), nativeDecimals)
    })
    .catch((error: unknown) => {
      throw new Error(normalizeNativeTransferError(error, {
        phase: "send",
        source: input.source,
        symbol,
      }));
    });
  await tx.wait().catch((error: unknown) => {
    throw new Error(normalizeNativeTransferError(error, {
      phase: "send",
      source: input.source,
      symbol,
    }));
  });

  return tx.hash;
}

export async function sendNativeTransferFromSmartAccount(
  input: NativeTransferInput,
  account: Account,
  options: {
    riskGuardValidatorAddress?: string;
    symbol?: string;
    walletAddress?: string;
  } = {}
) {
  const transaction = buildThirdwebTransferTransaction(
    input.recipient.trim(),
    parseUnits(input.amount.trim(), nativeDecimals)
  );
  return sendRiskGuardedSmartTransaction({
    account,
    transaction,
    ...(options.riskGuardValidatorAddress ? { riskGuardValidatorAddress: options.riskGuardValidatorAddress } : {}),
    ...(options.walletAddress ? { walletAddress: options.walletAddress } : {}),
  }).catch((error: unknown) => {
    throw new Error(normalizeNativeTransferError(error, {
      phase: "send",
      source: input.source,
      symbol: options.symbol ?? "native token",
    }));
  });
}
