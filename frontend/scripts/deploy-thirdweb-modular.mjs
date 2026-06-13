import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createThirdwebClient, defineChain } from "thirdweb";
import { deployPublishedContract } from "thirdweb/deploys";
import { privateKeyToAccount } from "thirdweb/wallets/private-key";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const envPath = path.join(repoRoot, ".env");
const publicChainsPath = path.join(repoRoot, "config/public-chains.json");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

async function rpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${payload.error.message}`);
  }
  return payload.result;
}

async function getBlockNumber(rpcUrl) {
  return Number(BigInt(await rpc(rpcUrl, "eth_blockNumber")));
}

async function getBalance(rpcUrl, address) {
  return BigInt(await rpc(rpcUrl, "eth_getBalance", [address, "latest"]));
}

async function collectSenderTransactions(rpcUrl, sender, fromBlock, toBlock) {
  const normalizedSender = sender.toLowerCase();
  const transactions = [];

  for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
    const block = await rpc(rpcUrl, "eth_getBlockByNumber", [
      `0x${blockNumber.toString(16)}`,
      true
    ]);
    for (const tx of block?.transactions ?? []) {
      if (tx.from?.toLowerCase() !== normalizedSender) {
        continue;
      }

      const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [tx.hash]);
      transactions.push({
        blockNumber,
        contractAddress: receipt.contractAddress,
        gasUsed: BigInt(receipt.gasUsed).toString(),
        status: receipt.status,
        to: tx.to,
        transactionHash: tx.hash
      });
    }
  }

  return transactions;
}

function formatNative(wei, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = wei / base;
  const fraction = wei % base;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 6);
  return `${whole}.${fractionText}`;
}

loadDotEnv(envPath);

const publicChains = JSON.parse(fs.readFileSync(publicChainsPath, "utf8"));
const publicChain = publicChains.chains[publicChains.defaultChain];
const nativeDecimals = publicChain.nativeCurrency.decimals;
const rpcUrl = publicChain.rpcUrl;
const secretKey = process.env.THIRDWEB_SECRET_KEY;
const clientId = process.env.THIRDWEB_CLIENT_ID || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;
const privateKey = process.env.WALLET_DEPLOYER_PRIVATE_KEY;

if (!secretKey && !clientId) {
  throw new Error("Set THIRDWEB_SECRET_KEY or THIRDWEB_CLIENT_ID before deploying.");
}
if (!privateKey) {
  throw new Error("Set WALLET_DEPLOYER_PRIVATE_KEY before deploying.");
}

const client = createThirdwebClient(
  secretKey ? { secretKey } : { clientId }
);
const chain = defineChain({
  blockExplorers: [{ name: "Somnia Explorer", url: publicChain.blockExplorerUrl }],
  id: publicChain.chainId,
  name: publicChain.name,
  nativeCurrency: publicChain.nativeCurrency,
  rpc: rpcUrl,
  testnet: true
});
const account = privateKeyToAccount({ client, privateKey });
const publisher = "0xdd99b75f095d0c4d5112aCe938e4e6ed962fb024";

const startBlock = await getBlockNumber(rpcUrl);
const startingBalance = await getBalance(rpcUrl, account.address);

console.log(`deployer=${account.address}`);
console.log(`startBlock=${startBlock}`);
console.log(`startingBalance=${formatNative(startingBalance, nativeDecimals)} ${publicChain.nativeCurrency.symbol}`);

const defaultValidator = await deployPublishedContract({
  account,
  chain,
  client,
  contractId: "DefaultValidator",
  publisher,
  salt: "somnia-riskguard-default-validator-v1"
});

console.log(`defaultValidator=${defaultValidator}`);

const modularAccountFactory = await deployPublishedContract({
  account,
  chain,
  client,
  contractId: "ModularAccountFactory",
  contractParams: {
    _owner: account.address
  },
  publisher,
  salt: "somnia-riskguard-modular-account-factory-v1"
});

console.log(`modularAccountFactory=${modularAccountFactory}`);

const endBlock = await getBlockNumber(rpcUrl);
const endingBalance = await getBalance(rpcUrl, account.address);
const transactions = await collectSenderTransactions(rpcUrl, account.address, startBlock, endBlock);

console.log(`endBlock=${endBlock}`);
console.log(`endingBalance=${formatNative(endingBalance, nativeDecimals)} ${publicChain.nativeCurrency.symbol}`);
console.log(`spent=${formatNative(startingBalance - endingBalance, nativeDecimals)} ${publicChain.nativeCurrency.symbol}`);
console.log(JSON.stringify({ defaultValidator, modularAccountFactory, transactions }, null, 2));
