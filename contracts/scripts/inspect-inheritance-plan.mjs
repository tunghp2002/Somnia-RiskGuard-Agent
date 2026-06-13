import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Contract, Interface, JsonRpcProvider, formatEther } =
  require("../../frontend/node_modules/ethers");

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
const smartAccount = process.argv[2] ?? env.SMART_ACCOUNT_ADDRESS;
const registryAddress = env.INHERITANCE_REGISTRY_CONTRACT_ADDRESS;
const rpcUrl = publicChain.rpcUrl;

if (!rpcUrl || !registryAddress || !smartAccount) {
  throw new Error(
    "Usage: pnpm --dir contracts exec node scripts/inspect-inheritance-plan.mjs <smart-account>"
  );
}

const abi = [
  "function plans(address) view returns (address smartAccount,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod,uint256 lastHeartbeatAt,uint256 createdAt,uint256 updatedAt,uint256 executedAt,uint8 state)",
  "function timelockEndsAt(address) view returns (uint256)",
  "function currentDistributionScheduleMs(address) view returns (uint256)",
  "function pendingDistributionRequestId(address) view returns (uint256)",
  "function distributionComplete(address) view returns (bool)",
  "function agentBudgetOf(address) view returns (uint256)",
  "function agentPlatform() view returns (address)",
  "function distributionAgentId() view returns (uint256)",
  "event PlanCreated(address indexed smartAccount,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)",
  "event DistributionScheduled(address indexed smartAccount,uint256 indexed timestampMs,uint64 subscriptionId)",
  "event DistributionScheduleFailed(address indexed smartAccount,uint256 indexed timestampMs)",
  "event ReactiveDistributionAgentRequested(address indexed smartAccount,uint256 indexed requestId)",
  "event ReactiveDistributionSucceeded(address indexed smartAccount,uint256 settledCount)"
];

const provider = new JsonRpcProvider(rpcUrl);
const registry = new Contract(registryAddress, abi, provider);
const latestBlock = await provider.getBlock("latest");
const [
  smartBalance,
  registryBalance,
  plan,
  deadline,
  scheduleMs,
  pendingRequestId,
  distributionComplete,
  agentBudget,
  agentPlatform,
  distributionAgentId
] = await Promise.all([
  provider.getBalance(smartAccount),
  provider.getBalance(registryAddress),
  registry.plans(smartAccount),
  registry.timelockEndsAt(smartAccount),
  registry.currentDistributionScheduleMs(smartAccount),
  registry.pendingDistributionRequestId(smartAccount),
  registry.distributionComplete(smartAccount),
  registry.agentBudgetOf(smartAccount),
  registry.agentPlatform(),
  registry.distributionAgentId()
]);

const now = BigInt(latestBlock.timestamp);
const summary = {
  registryAddress,
  smartAccount,
  latestBlock: latestBlock.number,
  now: latestBlock.timestamp,
  nowIso: new Date(latestBlock.timestamp * 1000).toISOString(),
  smartBalanceStt: formatEther(smartBalance),
  registryBalanceStt: formatEther(registryBalance),
  state: plan.state.toString(),
  active: plan.state === 1n,
  heartbeatInterval: plan.heartbeatInterval.toString(),
  lastHeartbeatAt: plan.lastHeartbeatAt.toString(),
  deadline: deadline.toString(),
  deadlineIso: new Date(Number(deadline) * 1000).toISOString(),
  expired: now >= deadline,
  scheduleMs: scheduleMs.toString(),
  pendingRequestId: pendingRequestId.toString(),
  distributionComplete,
  agentBudgetStt: formatEther(agentBudget),
  agentPlatform,
  distributionAgentId: distributionAgentId.toString()
};

console.log(JSON.stringify(summary, null, 2));

const iface = new Interface(abi);
const latest = await provider.getBlockNumber();
const fromBlock = Math.max(0, latest - 200_000);
const logs = [];
for (let from = fromBlock; from <= latest; from += 1_000) {
  const to = Math.min(latest, from + 999);
  const chunk = await provider.getLogs({ address: registryAddress, fromBlock: from, toBlock: to });
  logs.push(...chunk);
}
const events = logs
  .map((log) => {
    try {
      const parsed = iface.parseLog(log);
      return {
        block: log.blockNumber,
        tx: log.transactionHash,
        name: parsed.name,
        args: parsed.args.map((value) => value?.toString?.() ?? value)
      };
    } catch {
      return undefined;
    }
  })
  .filter(Boolean);

console.log(JSON.stringify({ events: events.slice(-30) }, null, 2));
