import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } =
  require("../../frontend/node_modules/ethers");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const env = {
  ...loadEnv(resolve(repoRoot, ".env")),
  ...process.env
};
const publicChains = JSON.parse(
  readFileSync(resolve(repoRoot, "config", "public-chains.json"), "utf8")
);
const publicChain = publicChains.chains[publicChains.defaultChain];

const registryAbi = [
  "function withdrawReactivityBudget(address payable to,uint256 amount)",
  "function admin() view returns (address)"
];

function loadEnv(path) {
  try {
    const contents = readFileSync(path, "utf8");
    return Object.fromEntries(
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          const key = line.slice(0, index).trim();
          const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
          return [key, value];
        })
    );
  } catch {
    return {};
  }
}

function requireEnv(name) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function usage() {
  return [
    "Usage:",
    "  pnpm --dir contracts inheritance:reactivity-balance",
    "  pnpm --dir contracts inheritance:reactivity-fund <amount-stt>",
    "  pnpm --dir contracts inheritance:reactivity-withdraw <amount-stt> [to]"
  ].join("\n");
}

async function main() {
  const action = process.argv[2] ?? "balance";
  const rpcUrl = env.SOMNIA_RPC_URL || env.NEXT_PUBLIC_SOMNIA_RPC_URL || publicChain.rpcUrl;
  const registryAddress =
    env.INHERITANCE_REGISTRY_CONTRACT_ADDRESS || publicChain.contracts.inheritanceRegistry;
  if (!rpcUrl) throw new Error("Missing SOMNIA_RPC_URL");
  if (!registryAddress) throw new Error("Missing INHERITANCE_REGISTRY_CONTRACT_ADDRESS");

  const provider = new JsonRpcProvider(rpcUrl);
  const balance = async () => {
    const value = await provider.getBalance(registryAddress);
    console.log(`InheritanceRegistry ${registryAddress} balance: ${formatEther(value)} STT`);
  };

  if (action === "balance") {
    await balance();
    return;
  }

  const wallet = new Wallet(requireEnv("WALLET_DEPLOYER_PRIVATE_KEY"), provider);
  const registry = new Contract(registryAddress, registryAbi, wallet);
  const amountArg = process.argv[3];
  if (!amountArg) {
    throw new Error(`Missing amount.\n${usage()}`);
  }
  const amount = parseEther(amountArg);

  if (action === "fund") {
    console.log(`Funding ${registryAddress} with ${amountArg} STT from ${wallet.address}`);
    const tx = await wallet.sendTransaction({ to: registryAddress, value: amount });
    console.log(`Fund tx: ${tx.hash}`);
    await tx.wait();
    await balance();
    return;
  }

  if (action === "withdraw") {
    const to = process.argv[4] ?? wallet.address;
    const admin = await registry.admin();
    if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(`Wallet ${wallet.address} is not registry admin ${admin}`);
    }
    console.log(`Withdrawing ${amountArg} STT from ${registryAddress} to ${to}`);
    const tx = await registry.withdrawReactivityBudget(to, amount);
    console.log(`Withdraw tx: ${tx.hash}`);
    await tx.wait();
    await balance();
    return;
  }

  throw new Error(`Unknown action: ${action}\n${usage()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
