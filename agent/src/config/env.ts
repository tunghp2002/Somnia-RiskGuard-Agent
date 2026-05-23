import { fileURLToPath } from "node:url";

import { config as loadDotenvFile } from "dotenv";
import { getAddress, Wallet } from "ethers";
import { z } from "zod";

import { loadPublicChainMetadata, PublicChainConfigError } from "./public-chain.js";

const ethereumAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid EVM address")
  .transform((value) => getAddress(value));

const optionalEthereumAddressSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  ethereumAddressSchema.optional()
);

const privateKeySchema = z.preprocess(
  (value) =>
    typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value)
      ? `0x${value}`
      : value,
  z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "Must be a 32-byte hex private key")
    .refine((value) => {
      try {
        new Wallet(value);
        return true;
      } catch {
        return false;
      }
    }, "Must be a valid secp256k1 private key")
);

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const optionalNumericString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^-?\d+$/, "Must be an integer string")
    .refine((value) => Number.isSafeInteger(Number(value)), {
      message: "Must be a safe integer"
    })
    .optional()
);

const optionalTelegramBotToken = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]+$/, "Must be a valid Telegram bot token")
    .optional()
);

const requiredNonEmptyString = (fieldName: string) =>
  z.string({ error: `${fieldName} is required` }).trim().min(1, {
    message: `${fieldName} is required`
  });

const defaultModelString = (defaultValue: string) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).default(defaultValue)
  );

const integerFromString = (fieldName: string) =>
  z
    .string({ error: `${fieldName} is required` })
    .regex(/^-?\d+$/, "Must be an integer string")
    .refine((value) => Number.isSafeInteger(Number(value)), {
      message: "Must be a safe integer"
    })
    .transform((value) => Number(value));

const numberFromString = (fieldName: string) =>
  z
    .string({ error: `${fieldName} is required` })
    .regex(/^-?\d+(\.\d+)?$/, "Must be a number string")
    .transform((value) => Number(value));

const booleanFromString = z
  .string({ error: "AUTO_CLAIM_ENABLED is required" })
  .transform((value, context) => {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Must be either true or false"
    });
    return z.NEVER;
  });

const defaultDotenvPath = fileURLToPath(new URL("../../../.env", import.meta.url));

const rawEnvSchema = z
  .object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  PUBLIC_CHAIN_KEY: requiredNonEmptyString("PUBLIC_CHAIN_KEY"),
  PUBLIC_CHAIN_NAME: requiredNonEmptyString("PUBLIC_CHAIN_NAME"),
  PUBLIC_CHAIN_EXPLORER_URL: z.string().url("Must be a valid URL"),
  PUBLIC_CHAIN_NATIVE_CURRENCY_NAME: requiredNonEmptyString("PUBLIC_CHAIN_NATIVE_CURRENCY_NAME"),
  PUBLIC_CHAIN_NATIVE_CURRENCY_SYMBOL: requiredNonEmptyString("PUBLIC_CHAIN_NATIVE_CURRENCY_SYMBOL"),
  PUBLIC_CHAIN_NATIVE_CURRENCY_DECIMALS: integerFromString("PUBLIC_CHAIN_NATIVE_CURRENCY_DECIMALS").pipe(
    z.number().int().nonnegative()
  ),
  SOMNIA_RPC_URL: z.string().url("Must be a valid URL"),
  SOMNIA_CHAIN_ID: integerFromString("SOMNIA_CHAIN_ID").pipe(
    z.number().int().positive()
  ),
  AGENT_WALLET_ADDRESS: ethereumAddressSchema,
  AGENT_PRIVATE_KEY: privateKeySchema,
  MONITORED_WALLET_ADDRESS: optionalEthereumAddressSchema,
  GROQ_API_KEY: requiredNonEmptyString("GROQ_API_KEY"),
  GROQ_MODEL: defaultModelString("llama-3.3-70b-versatile"),
  DEEPSEEK_API_KEY: requiredNonEmptyString("DEEPSEEK_API_KEY"),
  DEEPSEEK_MODEL: defaultModelString("deepseek-chat"),
  RISK_SCORE_ALERT_THRESHOLD: integerFromString(
    "RISK_SCORE_ALERT_THRESHOLD"
  ).pipe(z.number().int().min(0).max(100)),
  HEARTBEAT_INTERVAL_SECONDS: integerFromString(
    "HEARTBEAT_INTERVAL_SECONDS"
  ).pipe(z.number().int().positive()),
  HEARTBEAT_GRACE_SECONDS: integerFromString("HEARTBEAT_GRACE_SECONDS").pipe(
    z.number().int().positive()
  ),
  INHERITANCE_REGISTRY_CONTRACT_ADDRESS: optionalEthereumAddressSchema,
  AUTO_CLAIM_ENABLED: booleanFromString,
  MAX_CLAIM_GAS_USD: numberFromString("MAX_CLAIM_GAS_USD").pipe(
    z.number().nonnegative()
  ),
  MIN_REWARD_VALUE_USD: numberFromString("MIN_REWARD_VALUE_USD").pipe(
    z.number().nonnegative()
  ),
  TELEGRAM_BOT_TOKEN: optionalTelegramBotToken,
  TELEGRAM_BOT_USERNAME: optionalNonEmptyString,
  TELEGRAM_CHAT_ID: optionalNumericString,
  TELEGRAM_WEBHOOK_SECRET: optionalNonEmptyString
})
  .superRefine((env, context) => {
    if (!env.SOMNIA_RPC_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be configured through config/public-chains.json or SOMNIA_RPC_URL legacy override",
        path: ["SOMNIA_RPC_URL"]
      });
    }

    if (!env.SOMNIA_CHAIN_ID || Number(env.SOMNIA_CHAIN_ID) <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be configured through config/public-chains.json or SOMNIA_CHAIN_ID legacy override",
        path: ["SOMNIA_CHAIN_ID"]
      });
    }

    if (env.AGENT_PRIVATE_KEY && env.AGENT_WALLET_ADDRESS) {
      let derivedAddress: string;

      try {
        derivedAddress = new Wallet(env.AGENT_PRIVATE_KEY).address;
      } catch {
        return;
      }

      if (derivedAddress !== env.AGENT_WALLET_ADDRESS) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Must match the address derived from AGENT_PRIVATE_KEY",
          path: ["AGENT_WALLET_ADDRESS"]
        });
      }
    }

    if (!env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TELEGRAM_BOT_TOKEN must be set when TELEGRAM_CHAT_ID is configured",
        path: ["TELEGRAM_BOT_TOKEN"]
      });
    }
  });

export const secretEnvKeys = [
  "AGENT_PRIVATE_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET"
] as const;

export const agentEnvSchema = rawEnvSchema.transform((env) => ({
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  somnia: {
    rpcUrl: env.SOMNIA_RPC_URL,
    chainId: Number(env.SOMNIA_CHAIN_ID),
    agentWalletAddress: env.AGENT_WALLET_ADDRESS,
    agentPrivateKey: env.AGENT_PRIVATE_KEY,
    monitoredWalletAddress: env.MONITORED_WALLET_ADDRESS,
    inheritanceRegistryContractAddress: env.INHERITANCE_REGISTRY_CONTRACT_ADDRESS
  },
  publicChain: {
    key: env.PUBLIC_CHAIN_KEY,
    name: env.PUBLIC_CHAIN_NAME,
    rpcUrl: env.SOMNIA_RPC_URL,
    chainId: Number(env.SOMNIA_CHAIN_ID),
    blockExplorerUrl: env.PUBLIC_CHAIN_EXPLORER_URL,
    nativeCurrency: {
      name: env.PUBLIC_CHAIN_NATIVE_CURRENCY_NAME,
      symbol: env.PUBLIC_CHAIN_NATIVE_CURRENCY_SYMBOL,
      decimals: Number(env.PUBLIC_CHAIN_NATIVE_CURRENCY_DECIMALS)
    },
    contracts: {
      inheritanceRegistry: env.INHERITANCE_REGISTRY_CONTRACT_ADDRESS
    }
  },
  llm: {
    groq: {
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL
    },
    deepSeek: {
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL
    }
  },
  riskScore: {
    alertThreshold: env.RISK_SCORE_ALERT_THRESHOLD
  },
  heartbeat: {
    intervalSeconds: env.HEARTBEAT_INTERVAL_SECONDS,
    graceSeconds: env.HEARTBEAT_GRACE_SECONDS
  },
  rewards: {
    autoClaimEnabled: env.AUTO_CLAIM_ENABLED,
    maxClaimGasUsd: env.MAX_CLAIM_GAS_USD,
    minRewardValueUsd: env.MIN_REWARD_VALUE_USD
  },
  telegram: {
    enabled: Boolean(env.TELEGRAM_BOT_TOKEN),
    botToken: env.TELEGRAM_BOT_TOKEN,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    chatId: env.TELEGRAM_CHAT_ID,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET
  }
}));

export type AgentConfig = z.infer<typeof agentEnvSchema>;

export class ConfigValidationError extends Error {
  public readonly issues: z.ZodIssue[];

  public constructor(issues: z.ZodIssue[]) {
    super("Agent runtime configuration is invalid");
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export class PublicConfigValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicConfigValidationError";
  }
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  loadDotenv?: boolean;
  dotenvPath?: string;
}

export function validateConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): AgentConfig {
  let publicChain;

  try {
    publicChain = loadPublicChainMetadata(env.PUBLIC_CHAIN_KEY);
  } catch (error) {
    if (error instanceof PublicChainConfigError) {
      throw new PublicConfigValidationError(error.message);
    }

    throw error;
  }

  const envWithPublicDefaults = {
    ...env,
    SOMNIA_RPC_URL: publicChain.rpcUrl,
    SOMNIA_CHAIN_ID: String(publicChain.chainId),
    INHERITANCE_REGISTRY_CONTRACT_ADDRESS: publicChain.contracts.inheritanceRegistry,
    PUBLIC_CHAIN_KEY: publicChain.key,
    PUBLIC_CHAIN_NAME: publicChain.name,
    PUBLIC_CHAIN_EXPLORER_URL: publicChain.blockExplorerUrl,
    PUBLIC_CHAIN_NATIVE_CURRENCY_NAME: publicChain.nativeCurrency.name,
    PUBLIC_CHAIN_NATIVE_CURRENCY_SYMBOL: publicChain.nativeCurrency.symbol,
    PUBLIC_CHAIN_NATIVE_CURRENCY_DECIMALS: String(publicChain.nativeCurrency.decimals)
  };

  const result = agentEnvSchema.safeParse(envWithPublicDefaults);

  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }

  return result.data;
}

export function loadConfig(options: LoadConfigOptions = {}): AgentConfig {
  if (options.loadDotenv !== false) {
    loadDotenvFile({ path: options.dotenvPath ?? defaultDotenvPath });
  }

  return validateConfig(options.env ?? process.env);
}

export function formatConfigError(error: ConfigValidationError): string {
  const lines = error.issues.map((issue) => {
    const field = issue.path.join(".") || "ENV";
    const message = issue.message.includes("received undefined")
      ? `${field} is required`
      : issue.message;
    return `- ${field}: ${message}`;
  });

  return ["Agent runtime configuration is invalid:", ...lines].join("\n");
}
