import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

const foundryBinDirs = [
  join(homedir(), ".foundry", "bin"),
  process.env.USERPROFILE ? join(process.env.USERPROFILE, ".foundry", "bin") : undefined,
].filter(Boolean);

const executableName = process.platform === "win32" ? "forge.exe" : "forge";
const explicitForge = process.env.FOUNDRY_FORGE;
const localForge = foundryBinDirs
  .map((dir) => join(dir, executableName))
  .find((candidate) => existsSync(candidate));
const forge = explicitForge || localForge || executableName;

const args = process.argv.slice(2);
const env = {
  ...process.env,
  PATH: [...foundryBinDirs, process.env.PATH || ""].join(delimiter),
};

const child = spawn(forge, args, {
  env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(
      [
        "Foundry forge was not found.",
        "Install Foundry first, then rerun the command:",
        "  Linux/WSL: curl -L https://foundry.paradigm.xyz | bash && foundryup",
        "  Windows:  iwr https://foundry.paradigm.xyz -UseBasicParsing | iex; foundryup",
        "You can also set FOUNDRY_FORGE to the full forge executable path.",
      ].join("\n"),
    );
    process.exit(127);
  }

  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`forge exited with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
