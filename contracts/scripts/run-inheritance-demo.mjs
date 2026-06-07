import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  createThirdwebClient,
  defineChain,
  getContract,
  prepareContractCall,
  readContract,
  sendAndConfirmTransaction
} = require("../../frontend/node_modules/thirdweb");
const { smartWallet } =
  require("../../frontend/node_modules/thirdweb/dist/cjs/exports/wallets.js");
const { privateKeyToAccount } =
  require("../../frontend/node_modules/thirdweb/dist/cjs/exports/wallets/private-key.js");
const { Config } =
  require("../../frontend/node_modules/thirdweb/dist/cjs/exports/wallets/smart.js");
const { createAccountWithModules } =
  require("../../frontend/node_modules/thirdweb/dist/cjs/extensions/erc7579/__generated__/ModularAccountFactory/write/createAccountWithModules.js");
const { Contract, JsonRpcProvider, Wallet, formatEther, hexlify, toUtf8Bytes } =
  require("../../frontend/node_modules/ethers");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

function loadEnv(path) {
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
}

const env = { ...loadEnv(resolve(repoRoot, ".env")), ...process.env };
const publicChains = JSON.parse(
  readFileSync(resolve(repoRoot, "config", "public-chains.json"), "utf8")
);
const publicChain = publicChains.chains[publicChains.defaultChain];
const registryAddress =
  env.INHERITANCE_REGISTRY_CONTRACT_ADDRESS ?? publicChain.contracts.inheritanceRegistry;
const rpcUrl = env.SOMNIA_RPC_URL ?? env.NEXT_PUBLIC_SOMNIA_RPC_URL ?? publicChain.rpcUrl;
const smartAccountAddress = process.argv[2] ?? "0xcF750bF57031695d0F4B6E340dd0E561D130AA5E";
const beneficiaryAddress = process.argv[3] ?? "0x9A80af5b81E9792E641A4761BC28fE4309A156dA";
const heartbeatSeconds = BigInt(process.argv[4] ?? "5");
const zeroAddress = "0x0000000000000000000000000000000000000000";
const riskGuardAccountSalt = "riskguard-v2-2026-06-01";
const smartAccountAdminRole = 1n;

function requireEnv(name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const client = createThirdwebClient(
  env.THIRDWEB_SECRET_KEY
    ? { secretKey: env.THIRDWEB_SECRET_KEY }
    : { clientId: requireEnv("THIRDWEB_CLIENT_ID") }
);
const chain = defineChain({
  blockExplorers: [{ name: "Somnia Explorer", url: publicChain.blockExplorerUrl }],
  id: publicChain.chainId,
  name: publicChain.name,
  nativeCurrency: publicChain.nativeCurrency,
  rpc: rpcUrl,
  testnet: true
});
const provider = new JsonRpcProvider(rpcUrl);
const deployer = new Wallet(requireEnv("WALLET_DEPLOYER_PRIVATE_KEY"), provider);
const personalAccount = privateKeyToAccount({
  client,
  privateKey: requireEnv("WALLET_DEPLOYER_PRIVATE_KEY")
});

function accountAbstraction(validatorAddress) {
  return Config.erc7579({
    chain,
    factoryAddress: publicChain.contracts.riskGuardModularAccountFactory,
    sponsorGas: false,
    validatorAddress,
    overrides: { accountSalt: riskGuardAccountSalt }
  });
}

async function connectExpectedSmartAccount() {
  const candidates = [
    ["riskguard", publicChain.contracts.riskGuardValidatorModule],
    ["default", publicChain.contracts.riskGuardDefaultValidator]
  ].filter(([, validator]) => Boolean(validator));

  const matches = [];
  for (const [name, validator] of candidates) {
    const wallet = smartWallet(accountAbstraction(validator));
    const account = await wallet.connect({ client, personalAccount });
    console.log(`candidate ${name}: ${account.address}`);
    if (account.address.toLowerCase() === smartAccountAddress.toLowerCase()) {
      matches.push({ account, validatorName: name });
    }
  }

  const preferred = matches.find((match) => match.validatorName === "default") ?? matches[0];
  if (preferred) return preferred;

  throw new Error(`Private key did not resolve expected smart account ${smartAccountAddress}`);
}

async function deploySmartAccountIfNeeded() {
  const code = await provider.getCode(smartAccountAddress);
  if (code !== "0x") {
    console.log("smart account already deployed");
    return;
  }

  const salt = hexlify(toUtf8Bytes(riskGuardAccountSalt));
  const factory = getContract({
    address: publicChain.contracts.riskGuardModularAccountFactory,
    chain,
    client
  });
  const predicted = await readContract({
    contract: factory,
    method: "function getAddress(address owner, bytes salt) returns (address)",
    params: [deployer.address, salt]
  });
  if (predicted.toLowerCase() !== smartAccountAddress.toLowerCase()) {
    throw new Error(`Factory predicts ${predicted}, not expected ${smartAccountAddress}`);
  }

  const modules = [
    {
      moduleTypeId: 1n,
      module: publicChain.contracts.riskGuardDefaultValidator,
      initData: "0x"
    }
  ];
  const tx = createAccountWithModules({
    contract: factory,
    modules,
    owner: deployer.address,
    salt
  });
  const receipt = await sendAndConfirmTransaction({ account: personalAccount, transaction: tx });
  console.log(`deploy smart account tx: ${receipt.transactionHash}`);

  const deployedCode = await provider.getCode(smartAccountAddress);
  if (deployedCode === "0x") {
    throw new Error("Smart account deployment transaction succeeded but code is still empty");
  }
}

async function ensureRegistryRole(account) {
  const roleAbi = [
    "function grantRoles(address user,uint256 roles)",
    "function hasAnyRole(address user,uint256 roles) view returns (bool)"
  ];
  const roleContract = new Contract(smartAccountAddress, roleAbi, deployer);
  const hasDirectRole = await roleContract
    .hasAnyRole(registryAddress, smartAccountAdminRole)
    .catch(() => false);
  if (hasDirectRole) {
    console.log("registry role already granted");
    return;
  }

  try {
    const tx = await roleContract.grantRoles(registryAddress, smartAccountAdminRole);
    console.log(`grantRoles owner tx: ${tx.hash}`);
    await tx.wait();
    return;
  } catch (error) {
    console.log(`direct grantRoles failed, trying UserOp: ${error.message}`);
  }

  const smartAccount = getContract({
    address: smartAccountAddress,
    chain,
    client
  });
  const hasRole = await readContract({
    contract: smartAccount,
    method: "function hasAnyRole(address user,uint256 roles) view returns (bool)",
    params: [registryAddress, smartAccountAdminRole]
  }).catch(() => false);

  if (hasRole) {
    console.log("registry role already granted");
    return;
  }

  const tx = prepareContractCall({
    contract: smartAccount,
    method: "function grantRoles(address user,uint256 roles)",
    params: [registryAddress, smartAccountAdminRole]
  });
  const receipt = await sendAndConfirmTransaction({ account, transaction: tx });
  console.log(`grantRoles tx: ${receipt.transactionHash}`);
}

async function ensureExecutorModule(account) {
  const smartAccount = getContract({
    address: smartAccountAddress,
    chain,
    client
  });
  const installed = await readContract({
    contract: smartAccount,
    method:
      "function isModuleInstalled(uint256 moduleTypeId,address module,bytes additionalContext) view returns (bool)",
    params: [2n, registryAddress, "0x"]
  }).catch(() => false);

  if (installed) {
    console.log("registry executor module already installed");
    return;
  }

  const tx = prepareContractCall({
    contract: smartAccount,
    method: "function installModule(uint256 moduleTypeId,address module,bytes initData)",
    params: [2n, registryAddress, "0x"]
  });
  const receipt = await sendAndConfirmTransaction({ account, transaction: tx });
  console.log(`install executor module tx: ${receipt.transactionHash}`);
}

async function fundAgentBudgetIfNeeded() {
  const registry = new Contract(
    registryAddress,
    [
      "function AGENT_SUBCOMMITTEE_SIZE() view returns (uint256)",
      "function agentBudgetOf(address smartAccount) view returns (uint256)",
      "function agentPlatform() view returns (address)",
      "function agentRewardPerCall() view returns (uint256)",
      "function fundAgentBudget(address smartAccount) payable"
    ],
    provider
  );
  const platformAddress = await registry.agentPlatform();
  if (platformAddress === zeroAddress) return;

  const platform = new Contract(
    platformAddress,
    ["function getRequestDeposit() view returns (uint256)"],
    provider
  );
  const [requestDeposit, rewardPerCall, subcommitteeSize, currentBudget] = await Promise.all([
    platform.getRequestDeposit(),
    registry.agentRewardPerCall(),
    registry.AGENT_SUBCOMMITTEE_SIZE(),
    registry.agentBudgetOf(smartAccountAddress)
  ]);
  const requiredBudget = requestDeposit + rewardPerCall * subcommitteeSize;
  if (currentBudget >= requiredBudget) {
    console.log(`agent budget already ${formatEther(currentBudget)} STT`);
    return;
  }

  const writable = registry.connect(deployer);
  const topUp = requiredBudget - currentBudget;
  const tx = await writable.fundAgentBudget(smartAccountAddress, { value: topUp });
  console.log(`fundAgentBudget tx: ${tx.hash}`);
  await tx.wait();
}

async function cancelActivePlanIfNeeded(account) {
  const registry = getContract({ address: registryAddress, chain, client });
  const plan = await readContract({
    contract: registry,
    method:
      "function getPlan(address smartAccount) view returns ((address smartAccount,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod,uint256 lastHeartbeatAt,uint256 createdAt,uint256 updatedAt,uint256 executedAt,uint8 state),(address addr,uint256 shareBps)[],(address token)[])",
    params: [smartAccountAddress]
  }).catch(() => undefined);
  const state = plan?.[0]?.state ?? 0;
  if (state !== 1) return;

  const tx = prepareContractCall({
    contract: registry,
    method: "function cancelPlan()",
    params: []
  });
  const receipt = await sendAndConfirmTransaction({ account, transaction: tx });
  console.log(`cancelPlan tx: ${receipt.transactionHash}`);
}

async function createPlan() {
  const registry = new Contract(
    registryAddress,
    [
      "function createPlanFor(address smartAccount,(address addr,uint256 shareBps)[] beneficiaries,(address token)[] protectedAssets,uint256 heartbeatInterval,uint256 gracePeriod,uint256 timelockPeriod)"
    ],
    deployer
  );
  const tx = await registry.createPlanFor(
    smartAccountAddress,
    [{ addr: beneficiaryAddress, shareBps: 10_000n }],
    [{ token: zeroAddress }],
    heartbeatSeconds,
    0n,
    0n
  );
  console.log(`createPlanFor tx: ${tx.hash}`);
  await tx.wait();
}

async function executeFallbackIfNeeded() {
  const registry = new Contract(
    registryAddress,
    ["function executeInheritance(address smartAccount)"],
    deployer
  );
  const tx = await registry.executeInheritance(smartAccountAddress);
  console.log(`fallback executeInheritance tx: ${tx.hash}`);
  await tx.wait();
}

async function monitorUntilReceived(initialBeneficiaryBalance) {
  const start = Date.now();
  let fallbackSent = false;
  for (;;) {
    const [smartBalance, beneficiaryBalance] = await Promise.all([
      provider.getBalance(smartAccountAddress),
      provider.getBalance(beneficiaryAddress)
    ]);
    const elapsed = Math.floor((Date.now() - start) / 1000);
    console.log(
      `t+${elapsed}s smart=${formatEther(smartBalance)} STT beneficiary=${formatEther(
        beneficiaryBalance
      )} STT`
    );
    if (beneficiaryBalance > initialBeneficiaryBalance) {
      console.log("beneficiary received inheritance funds");
      return;
    }

    if (!fallbackSent && elapsed >= 45) {
      fallbackSent = true;
      await executeFallbackIfNeeded().catch((error) => {
        console.log(`fallback execute skipped: ${error.message}`);
      });
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
}

const initialSmartBalance = await provider.getBalance(smartAccountAddress);
const initialBeneficiaryBalance = await provider.getBalance(beneficiaryAddress);
console.log(`registry=${registryAddress}`);
console.log(`smart=${smartAccountAddress} balance=${formatEther(initialSmartBalance)} STT`);
console.log(
  `beneficiary=${beneficiaryAddress} initial=${formatEther(initialBeneficiaryBalance)} STT`
);

const { account, validatorName } = await connectExpectedSmartAccount();
console.log(`using ${validatorName} smart account`);
await deploySmartAccountIfNeeded();
await ensureRegistryRole(account);
await ensureExecutorModule(account);
await fundAgentBudgetIfNeeded();
await cancelActivePlanIfNeeded(account);
await createPlan();
await monitorUntilReceived(initialBeneficiaryBalance);
