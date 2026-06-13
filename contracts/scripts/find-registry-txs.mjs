import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { JsonRpcProvider } = require("../../frontend/node_modules/ethers");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

function loadEnv() {
  const envText = readFileSync(resolve(repoRoot, ".env"), "utf8");
  return Object.fromEntries(
    envText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

const env = loadEnv();
const publicChains = JSON.parse(
  readFileSync(resolve(repoRoot, "config", "public-chains.json"), "utf8")
);
const publicChain = publicChains.chains[publicChains.defaultChain];
const rpcUrl = publicChain.rpcUrl;
const registry = (process.argv[2] ?? env.INHERITANCE_REGISTRY_CONTRACT_ADDRESS).toLowerCase();
const fromBlock = Number(process.argv[3]);
const toBlock = Number(process.argv[4]);

if (!registry || !Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) {
  throw new Error("Usage: node scripts/find-registry-txs.mjs <registry> <fromBlock> <toBlock>");
}

const provider = new JsonRpcProvider(rpcUrl);
const matches = [];
async function scanBlock(blockNumber) {
  const block = await provider.getBlock(blockNumber, true);
  const txs = block?.prefetchedTransactions ?? [];
  const blockMatches = [];
  for (const tx of txs) {
    if (tx.to?.toLowerCase() === registry || tx.from?.toLowerCase() === registry) {
      blockMatches.push({
        block: blockNumber,
        timestamp: block.timestamp,
        tx: tx.hash,
        from: tx.from,
        to: tx.to,
        selector: tx.data.slice(0, 10),
        value: tx.value.toString()
      });
    }
  }
  return blockMatches;
}

const concurrency = 50;
for (let from = fromBlock; from <= toBlock; from += concurrency) {
  const to = Math.min(toBlock, from + concurrency - 1);
  const chunks = await Promise.all(
    Array.from({ length: to - from + 1 }, (_, index) => scanBlock(from + index))
  );
  matches.push(...chunks.flat());
}

console.log(JSON.stringify(matches, null, 2));
