import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Contract, JsonRpcProvider, Wallet, formatEther, getAddress, parseEther } = require("../../frontend/node_modules/ethers");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const env = {
  ...loadEnv(resolve(repoRoot, ".env")),
  ...process.env,
};
const publicChains = JSON.parse(readFileSync(resolve(repoRoot, "config/public-chains.json"), "utf8"));
const publicChain = publicChains.chains[publicChains.defaultChain];
const contracts = publicChain.contracts;

const agentRequesterByChainId = {
  5031: "0x5E5205CF39E766118C01636bED000A54D93163E6",
  50312: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776",
};

const riskGuardValidatorAbi = [
  "function configureRiskAgent(address platform,uint256 agentId) external",
  "function setRiskAgentRewardPerCall(uint256 newReward) external",
  "function agentPlatform() view returns (address)",
  "function riskAssessmentAgentId() view returns (uint256)",
  "function riskAgentRewardPerCall() view returns (uint256)",
];
const inheritanceRegistryAbi = [
  "function configureAgent(address platform,uint256 nextHeartbeatAgentId,uint256 nextDistributionAgentId) external",
  "function setAgentRewardPerCall(uint256 newReward) external",
  "function agentPlatform() view returns (address)",
  "function heartbeatAgentId() view returns (uint256)",
  "function distributionAgentId() view returns (uint256)",
  "function agentRewardPerCall() view returns (uint256)",
];
const approvalRiskScannerAbi = [
  "function configureAgents(address platform,uint256 jsonApiAgentId,uint256 parseWebsiteAgentId,uint256 llmInferenceAgentId) external",
  "function setAgentRewardPerCall(uint256 newReward) external",
  "function agentPlatform() view returns (address)",
  "function jsonApiAgentId() view returns (uint256)",
  "function parseWebsiteAgentId() view returns (uint256)",
  "function llmInferenceAgentId() view returns (uint256)",
  "function agentRewardPerCall() view returns (uint256)",
];

async function main() {
  const privateKey = requireEnv("WALLET_DEPLOYER_PRIVATE_KEY");
  const rpcUrl = publicChain.rpcUrl;
  const chainId = Number(publicChain.chainId);
  const configuredAgentRequester = env.SOMNIA_AGENT_REQUESTER_ADDRESS || agentRequesterByChainId[chainId];

  if (!configuredAgentRequester) {
    throw new Error(`Set SOMNIA_AGENT_REQUESTER_ADDRESS for chain ${chainId}.`);
  }

  const agentRequester = getAddress(configuredAgentRequester);

  const provider = new JsonRpcProvider(rpcUrl, chainId);
  const signer = new Wallet(privateKey, provider);

  console.log(`Configuring Somnia agents as ${signer.address}`);
  console.log(`AgentRequester: ${agentRequester}`);

  await configureRiskGuard({ agentRequester, signer });
  await configureInheritance({ agentRequester, signer });
  await configureApprovalRiskScanner({ agentRequester, signer });
}

async function configureRiskGuard({ agentRequester, signer }) {
  const agentId = env.RISK_GUARD_RISK_ASSESSMENT_AGENT_ID;
  const validatorAddress = env.RISK_GUARD_VALIDATOR_MODULE_ADDRESS || contracts.riskGuardValidatorModule;

  if (!agentId) {
    console.log("Skipping RiskGuardValidator: RISK_GUARD_RISK_ASSESSMENT_AGENT_ID is not set.");
    return;
  }

  if (!validatorAddress) {
    console.log("Skipping RiskGuardValidator: validator address is not configured.");
    return;
  }

  const validator = new Contract(validatorAddress, riskGuardValidatorAbi, signer);
  const tx = await validator.configureRiskAgent(agentRequester, BigInt(agentId));
  console.log(`RiskGuardValidator configure tx: ${tx.hash}`);
  await tx.wait();

  const reward = env.RISK_GUARD_AGENT_REWARD_PER_CALL_STT;
  if (reward) {
    const rewardTx = await validator.setRiskAgentRewardPerCall(parseEther(reward));
    console.log(`RiskGuardValidator reward tx: ${rewardTx.hash}`);
    await rewardTx.wait();
  }

  const [storedPlatform, storedAgentId, storedReward] = await Promise.all([
    validator.agentPlatform(),
    validator.riskAssessmentAgentId(),
    validator.riskAgentRewardPerCall(),
  ]);
  console.log(`RiskGuardValidator agentPlatform: ${storedPlatform}`);
  console.log(`RiskGuardValidator riskAssessmentAgentId: ${storedAgentId.toString()}`);
  console.log(`RiskGuardValidator riskAgentRewardPerCall: ${formatEther(storedReward)} STT`);
}

async function configureInheritance({ agentRequester, signer }) {
  const heartbeatAgentId = env.INHERITANCE_HEARTBEAT_AGENT_ID;
  const distributionAgentId = env.INHERITANCE_DISTRIBUTION_AGENT_ID;
  const registryAddress = env.INHERITANCE_REGISTRY_CONTRACT_ADDRESS || contracts.inheritanceRegistry;

  if (!heartbeatAgentId || !distributionAgentId) {
    console.log(
      "Skipping InheritanceRegistry: INHERITANCE_HEARTBEAT_AGENT_ID and INHERITANCE_DISTRIBUTION_AGENT_ID are not both set.",
    );
    return;
  }

  if (!registryAddress) {
    console.log("Skipping InheritanceRegistry: registry address is not configured.");
    return;
  }

  const registry = new Contract(registryAddress, inheritanceRegistryAbi, signer);
  const tx = await registry.configureAgent(
    agentRequester,
    BigInt(heartbeatAgentId),
    BigInt(distributionAgentId),
  );
  console.log(`InheritanceRegistry configure tx: ${tx.hash}`);
  await tx.wait();

  const reward = env.INHERITANCE_AGENT_REWARD_PER_CALL_STT;
  if (reward) {
    const rewardTx = await registry.setAgentRewardPerCall(parseEther(reward));
    console.log(`InheritanceRegistry reward tx: ${rewardTx.hash}`);
    await rewardTx.wait();
  }

  const [storedPlatform, storedHeartbeatAgentId, storedDistributionAgentId, storedReward] = await Promise.all([
    registry.agentPlatform(),
    registry.heartbeatAgentId(),
    registry.distributionAgentId(),
    registry.agentRewardPerCall(),
  ]);
  console.log(`InheritanceRegistry agentPlatform: ${storedPlatform}`);
  console.log(`InheritanceRegistry heartbeatAgentId: ${storedHeartbeatAgentId.toString()}`);
  console.log(`InheritanceRegistry distributionAgentId: ${storedDistributionAgentId.toString()}`);
  console.log(`InheritanceRegistry agentRewardPerCall: ${formatEther(storedReward)} STT`);
}

async function configureApprovalRiskScanner({ agentRequester, signer }) {
  const jsonApiAgentId = env.APPROVAL_SCANNER_JSON_API_AGENT_ID;
  const parseWebsiteAgentId = env.APPROVAL_SCANNER_PARSE_WEBSITE_AGENT_ID;
  const llmInferenceAgentId =
    env.APPROVAL_SCANNER_LLM_INFERENCE_AGENT_ID || env.RISK_GUARD_RISK_ASSESSMENT_AGENT_ID;
  const scannerAddress =
    env.APPROVAL_SCANNER_CONTRACT_ADDRESS || contracts.approvalRiskScanner;

  if (!jsonApiAgentId || !parseWebsiteAgentId || !llmInferenceAgentId) {
    console.log(
      "Skipping ApprovalRiskScanner: set APPROVAL_SCANNER_JSON_API_AGENT_ID, APPROVAL_SCANNER_PARSE_WEBSITE_AGENT_ID and APPROVAL_SCANNER_LLM_INFERENCE_AGENT_ID.",
    );
    return;
  }

  if (!scannerAddress) {
    console.log("Skipping ApprovalRiskScanner: scanner address is not configured.");
    return;
  }

  const scanner = new Contract(scannerAddress, approvalRiskScannerAbi, signer);
  const tx = await scanner.configureAgents(
    agentRequester,
    BigInt(jsonApiAgentId),
    BigInt(parseWebsiteAgentId),
    BigInt(llmInferenceAgentId),
  );
  console.log(`ApprovalRiskScanner configure tx: ${tx.hash}`);
  await tx.wait();

  const reward = env.APPROVAL_SCANNER_AGENT_REWARD_PER_CALL_STT;
  if (reward) {
    const rewardTx = await scanner.setAgentRewardPerCall(parseEther(reward));
    console.log(`ApprovalRiskScanner reward tx: ${rewardTx.hash}`);
    await rewardTx.wait();
  }

  const [storedPlatform, storedJson, storedWeb, storedInfer, storedReward] = await Promise.all([
    scanner.agentPlatform(),
    scanner.jsonApiAgentId(),
    scanner.parseWebsiteAgentId(),
    scanner.llmInferenceAgentId(),
    scanner.agentRewardPerCall(),
  ]);
  console.log(`ApprovalRiskScanner agentPlatform: ${storedPlatform}`);
  console.log(`ApprovalRiskScanner jsonApiAgentId: ${storedJson.toString()}`);
  console.log(`ApprovalRiskScanner parseWebsiteAgentId: ${storedWeb.toString()}`);
  console.log(`ApprovalRiskScanner llmInferenceAgentId: ${storedInfer.toString()}`);
  console.log(`ApprovalRiskScanner agentRewardPerCall: ${formatEther(storedReward)} STT`);
}

function loadEnv(path) {
  let content = "";

  try {
    content = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      }),
  );
}

function requireEnv(key) {
  const value = env[key];

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
