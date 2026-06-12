import {
  AbiCoder,
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  solidityPacked,
} from "ethers";
import {
  encode,
  getContract,
  prepareContractCall,
  type PreparedTransaction,
} from "thirdweb";
import { EIP1193, type Account } from "thirdweb/wallets";
import {
  bundleUserOp,
  createUnsignedUserOp,
  signUserOp,
  waitForUserOpReceipt,
  type UserOperation
} from "thirdweb/wallets/smart";

import { agentApi } from "@/lib/agent-api";
import {
  createThirdwebAccountAbstraction,
  riskGuardAccountSalt,
  somniaBrowserChainConfig,
  somniaChainIdHex,
  somniaRpcUrl,
  somniaThirdwebChain,
  thirdwebClient,
} from "@/lib/thirdweb-client";
import { ensureBrowserChain } from "@/lib/wallet";

const smartAccountExecuteGasLimit = 31_000_000n;
const signedReplayCallGasLimit = 31_000_000n;
const signedReplayVerificationGasLimit = 2_500_000n;
const signedReplayPreVerificationGas = 500_000n;
const signedReplayPaymasterVerificationGasLimit = 1n;
const signedReplayPaymasterPostOpGasLimit = 1n;
const zeroBytes32 = `0x${"00".repeat(32)}` as `0x${string}`;
const zeroAddress = "0x0000000000000000000000000000000000000000";

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

export class SomniaAgentReviewRequestedError extends Error {
  public constructor(public readonly requestTxHash: string) {
    super("Somnia Agent review requested on-chain.");
    this.name = "SomniaAgentReviewRequestedError";
  }
}

function getEthereumProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No browser wallet detected.");
  }

  return window.ethereum;
}

async function resolvePreparedValue<T>(value: T | (() => Promise<T>) | undefined) {
  return typeof value === "function"
    ? await (value as () => Promise<T>)()
    : value;
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
          txHash: parsed.args.txHash as string,
        };
      }
    } catch {
      // Keep scanning wrapped revert payloads.
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

async function buildAccountExecuteParams(transaction: PreparedTransaction) {
  const [data, to, value] = await Promise.all([
    encode(transaction),
    resolvePreparedValue(transaction.to),
    resolvePreparedValue(transaction.value),
  ]);

  if (!to) {
    throw new Error("RiskGuard cannot replay a transaction without a target address.");
  }

  return {
    mode: zeroBytes32,
    executionCalldata: solidityPacked(
      ["address", "uint256", "bytes"],
      [getAddress(to), value ?? 0n, data]
    ) as `0x${string}`,
  };
}

interface ExecuteParams {
  mode: `0x${string}`;
  executionCalldata: `0x${string}`;
}

export interface SmartCall {
  to: string;
  value?: bigint;
  data: `0x${string}`;
}

// ERC-7579 CALLTYPE_BATCH mode (first byte 0x01, padded right to 32 bytes), matching
// thirdweb's own batch encoding so a single signed UserOp performs every call.
const erc7579BatchMode = `0x01${"00".repeat(31)}` as `0x${string}`;

function buildBatchExecuteParams(calls: SmartCall[]): ExecuteParams {
  const executions = calls.map((call) => [
    getAddress(call.to),
    call.value ?? 0n,
    call.data,
  ]);
  const executionCalldata = AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,uint256,bytes)[]"],
    [executions]
  ) as `0x${string}`;

  return { mode: erc7579BatchMode, executionCalldata };
}

function hexJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return `0x${value.toString(16)}`;
  }

  if (Array.isArray(value)) {
    return value.map(hexJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, hexJson(item)])
    );
  }

  return value;
}

async function createSignedReplayUserOp(options: {
  account: Account;
  executeParams: ExecuteParams;
}) {
  if (!thirdwebClient) {
    throw new Error("Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID before signing the pending UserOp.");
  }

  const personalWallet = EIP1193.fromProvider({
    provider: getEthereumProvider() as Parameters<typeof EIP1193.fromProvider>[0]["provider"],
    walletId: "app.subwallet",
  });
  const personalAccount = await personalWallet.connect({
    chain: somniaThirdwebChain,
    client: thirdwebClient,
  });
  const smartWalletOptions = createThirdwebAccountAbstraction({
    validator: "riskguard",
    sponsorGas: true,
    overrides: {
      accountSalt: riskGuardAccountSalt,
      paymaster: async () => ({
        paymasterAndData: "0x",
        callGasLimit: signedReplayCallGasLimit,
        verificationGasLimit: signedReplayVerificationGasLimit,
        preVerificationGas: signedReplayPreVerificationGas,
        paymasterVerificationGasLimit: signedReplayPaymasterVerificationGasLimit,
        paymasterPostOpGasLimit: signedReplayPaymasterPostOpGasLimit,
      }),
    },
  });

  if (!smartWalletOptions.factoryAddress) {
    throw new Error("RiskGuard smart account factory is not configured.");
  }

  const accountContract = getContract({
    address: options.account.address as `0x${string}`,
    chain: somniaThirdwebChain,
    client: thirdwebClient,
  });
  const factoryContract = getContract({
    address: smartWalletOptions.factoryAddress as `0x${string}`,
    chain: somniaThirdwebChain,
    client: thirdwebClient,
  });
  const executeTransaction = prepareContractCall({
    contract: accountContract,
    method: "function execute(bytes32 mode, bytes executionCalldata)",
    gas: smartAccountExecuteGasLimit,
    params: [options.executeParams.mode, options.executeParams.executionCalldata],
  });
  const unsignedUserOp = await createUnsignedUserOp({
    accountContract,
    adminAddress: personalAccount.address,
    factoryContract,
    overrides: smartWalletOptions.overrides,
    sponsorGas: "sponsorGas" in smartWalletOptions
      ? smartWalletOptions.sponsorGas
      : smartWalletOptions.gasless,
    transaction: executeTransaction,
  });
  const signedUserOp = await signUserOp({
    adminAccount: personalAccount,
    chain: somniaThirdwebChain,
    client: thirdwebClient,
    ...(smartWalletOptions.overrides?.entrypointAddress
      ? { entrypointAddress: smartWalletOptions.overrides.entrypointAddress }
      : {}),
    userOp: unsignedUserOp,
  });

  return {
    ...(smartWalletOptions.overrides?.entrypointAddress
      ? { entrypointAddress: smartWalletOptions.overrides.entrypointAddress }
      : {}),
    serializedUserOp: hexJson(signedUserOp) as Record<string, unknown>,
    userOp: signedUserOp as UserOperation,
  };
}

async function requestSomniaAgentReview(options: {
  riskGuardValidatorAddress: string;
  smartAccountAddress: string;
  executeParams: ExecuteParams;
}) {
  await ensureBrowserChain(somniaChainIdHex, somniaBrowserChainConfig);
  const browserProvider = new BrowserProvider(getEthereumProvider());
  const readProvider = new JsonRpcProvider(somniaRpcUrl, Number(somniaThirdwebChain.id));
  const signer = await browserProvider.getSigner();
  const validatorReader = new Contract(
    options.riskGuardValidatorAddress,
    riskGuardValidatorInterface,
    readProvider
  );
  const validatorWriter = new Contract(
    options.riskGuardValidatorAddress,
    riskGuardValidatorInterface,
    signer
  );
  const agentPlatform = getAddress(
    await validatorReader.getFunction("agentPlatform").staticCall()
  );

  if (agentPlatform === getAddress(zeroAddress)) {
    throw new Error("Somnia RiskGuard agent is not configured on the validator contract.");
  }

  const platform = new Contract(agentPlatform, agentRequesterInterface, readProvider);
  const [requestDeposit, rewardPerCall, subcommitteeSize, currentBudget] = await Promise.all([
    platform.getFunction("getRequestDeposit").staticCall(),
    validatorReader.getFunction("riskAgentRewardPerCall").staticCall(),
    validatorReader.getFunction("AGENT_SUBCOMMITTEE_SIZE").staticCall(),
    validatorReader.getFunction("agentBudgetOf").staticCall(options.smartAccountAddress),
  ]) as [bigint, bigint, bigint, bigint];
  const requiredBudget = requestDeposit + (rewardPerCall * subcommitteeSize);

  if (currentBudget < requiredBudget) {
    const fundTx = await validatorWriter.getFunction("fundAgentBudget")(
      options.smartAccountAddress,
      { value: requiredBudget - currentBudget }
    );
    await fundTx.wait();
  }

  const callData = new Interface(["function execute(bytes32 mode, bytes executionCalldata)"])
    .encodeFunctionData("execute", [options.executeParams.mode, options.executeParams.executionCalldata]);
  const requestTx = await validatorWriter.getFunction("requestAgentReview")(
    options.smartAccountAddress,
    callData
  );
  const receipt = await requestTx.wait();

  return receipt?.hash ?? requestTx.hash;
}

async function sendGuardedExecute(options: {
  account: Account;
  executeParams: ExecuteParams;
  riskGuardValidatorAddress?: string;
  walletAddress?: string;
}) {
  if (!thirdwebClient) {
    throw new Error("Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID before sending a smart-account transaction.");
  }

  let pendingUserOp: Awaited<ReturnType<typeof createSignedReplayUserOp>> | undefined;

  try {
    pendingUserOp = await createSignedReplayUserOp({
      account: options.account,
      executeParams: options.executeParams,
    });
    const userOpHash = await bundleUserOp({
      userOp: pendingUserOp.userOp,
      options: {
        chain: somniaThirdwebChain,
        client: thirdwebClient,
        ...(pendingUserOp.entrypointAddress ? { entrypointAddress: pendingUserOp.entrypointAddress } : {}),
      },
    });
    const receipt = await waitForUserOpReceipt({
      chain: somniaThirdwebChain,
      client: thirdwebClient,
      ...(pendingUserOp.entrypointAddress ? { entrypointAddress: pendingUserOp.entrypointAddress } : {}),
      userOpHash,
    });

    return receipt.transactionHash;
  } catch (error) {
    const pendingApproval = extractRiskGuardPendingApproval(error);
    if (!pendingApproval) {
      throw error;
    }

    if (!options.riskGuardValidatorAddress) {
      throw new Error("RiskGuard requires Somnia Agent review, but the validator contract is not configured in public chain metadata.");
    }

    // Ask the agent backend to top up the validator's review budget first, so
    // the user does not have to sign a separate fundAgentBudget transaction.
    // Best-effort: if the backend cannot fund it, requestSomniaAgentReview still
    // falls back to funding from the user's wallet (no behaviour change).
    await agentApi
      .ensureRiskGuardReviewBudget({ smartAccountAddress: pendingApproval.smartAccountAddress })
      .catch(() => undefined);

    const reviewTxHash = await requestSomniaAgentReview({
      riskGuardValidatorAddress: options.riskGuardValidatorAddress,
      smartAccountAddress: pendingApproval.smartAccountAddress,
      executeParams: options.executeParams,
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

    if (options.walletAddress && pendingUserOp) {
      await agentApi.storeRiskGuardPendingUserOp({
        walletAddress: options.walletAddress,
        smartAccountAddress: pendingApproval.smartAccountAddress,
        guardedTxHash: pendingApproval.txHash,
        ...(pendingUserOp.entrypointAddress ? { entrypointAddress: pendingUserOp.entrypointAddress } : {}),
        userOp: pendingUserOp.serializedUserOp,
      });

      await agentApi.notifyRiskGuardAgentReviewRequested({
        walletAddress: options.walletAddress,
        smartAccountAddress: pendingApproval.smartAccountAddress,
        guardedTxHash: pendingApproval.txHash,
        requestTxHash: reviewTxHash,
      }).catch(() => undefined);
    }

    throw new SomniaAgentReviewRequestedError(reviewTxHash);
  }
}

export async function sendRiskGuardedSmartTransaction(options: {
  account: Account;
  riskGuardValidatorAddress?: string;
  transaction: PreparedTransaction;
  walletAddress?: string;
}) {
  const executeParams = await buildAccountExecuteParams(options.transaction);

  return sendGuardedExecute({
    account: options.account,
    executeParams,
    ...(options.riskGuardValidatorAddress
      ? { riskGuardValidatorAddress: options.riskGuardValidatorAddress }
      : {}),
    ...(options.walletAddress ? { walletAddress: options.walletAddress } : {}),
  });
}

// Execute several smart-account calls in a single signed UserOp (ERC-7579 batch).
// The whole batch is signed once, so flows that previously needed one signature
// per call (e.g. grantRoles + fundAgentBudget + createPlan) now ask the user to
// sign exactly once.
export async function sendRiskGuardedSmartBatch(options: {
  account: Account;
  calls: SmartCall[];
  riskGuardValidatorAddress?: string;
  walletAddress?: string;
}) {
  const executeParams = buildBatchExecuteParams(options.calls);

  return sendGuardedExecute({
    account: options.account,
    executeParams,
    ...(options.riskGuardValidatorAddress
      ? { riskGuardValidatorAddress: options.riskGuardValidatorAddress }
      : {}),
    ...(options.walletAddress ? { walletAddress: options.walletAddress } : {}),
  });
}
