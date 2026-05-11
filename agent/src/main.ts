import { pathToFileURL } from "node:url";

import {
  ConfigValidationError,
  formatConfigError,
  loadConfig,
  type AgentConfig,
  type LoadConfigOptions
} from "./config/env.js";

export interface MainOptions extends LoadConfigOptions {
  startRuntime?: (config: AgentConfig) => Promise<void> | void;
}

export async function main(options: MainOptions = {}): Promise<AgentConfig> {
  const config = loadConfig(options);

  await options.startRuntime?.(config);

  return config;
}

export async function runCli(options: MainOptions = {}): Promise<void> {
  try {
    await main(options);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(formatConfigError(error));
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entrypoint) {
  await runCli();
}
