import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ContractFactory, JsonRpcProvider, Wallet } =
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

async function main() {
  const rpcUrl = env.SOMNIA_RPC_URL || env.NEXT_PUBLIC_SOMNIA_RPC_URL || publicChain.rpcUrl;
  if (!rpcUrl) {
    throw new Error("Missing SOMNIA_RPC_URL");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(requireEnv("WALLET_DEPLOYER_PRIVATE_KEY"), provider);
  const artifactPath = resolve(
    resolve(repoRoot, "contracts", "out"),
    "ApprovalRiskScanner.sol",
    "ApprovalRiskScanner.json"
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, wallet);

  console.log(`Deploying ApprovalRiskScanner with ${wallet.address}`);
  const contract = await factory.deploy();
  const deploymentTx = contract.deploymentTransaction();
  console.log(`ApprovalRiskScanner deploy tx: ${deploymentTx?.hash ?? "pending"}`);
  await contract.waitForDeployment();
  console.log(`ApprovalRiskScanner deployed: ${await contract.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
