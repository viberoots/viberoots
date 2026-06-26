import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { BootstrapArgs, CommandRunner } from "./infisical-iac-bootstrap-types";
import { scrubControlPlaneChildEnv } from "./control-plane-process-env";
import { mkdtempNoindex } from "../lib/macos-metadata";

export const spawnCommandRunner: CommandRunner = (opts) => {
  const result = spawnSync(opts.command, opts.args, {
    cwd: opts.cwd,
    env: scrubControlPlaneChildEnv(opts.env),
    encoding: "utf8",
    stdio: opts.capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw commandSpawnError(opts.command, result.error);
  if (result.status !== 0) {
    const stderr = opts.capture && result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(
      `${opts.command} ${opts.args.join(" ")} failed with exit ${result.status}${stderr}`,
    );
  }
  return result.stdout ?? "";
};

function commandSpawnError(command: string, error: Error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") return error;
  if (command === "infisical") {
    return new Error(
      [
        "Infisical CLI was not found on PATH.",
        "Install the Infisical CLI, pass --infisical-bin <path>, or use --no-login with --access-token-env plus --org-name or --organization-id.",
      ].join("\n"),
    );
  }
  return new Error(`required command was not found on PATH: ${command}`);
}

export function extractToken(stdout: string) {
  const token = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!token) throw new Error("Infisical CLI did not return an access token");
  return token;
}

export async function getAccessToken(
  args: BootstrapArgs,
  runner: CommandRunner = spawnCommandRunner,
  env: NodeJS.ProcessEnv = process.env,
) {
  const envToken = env[args.accessTokenEnv]?.trim();
  if (envToken && !args.forceLogin) return { token: envToken };
  if (args.noLogin) {
    throw new Error(
      `missing Infisical access token env var: ${args.accessTokenEnv}; remove --no-login or export a token`,
    );
  }
  const tempHome = await mkdtempNoindex("infisical-iac-bootstrap-home-", {
    baseName: "infisical-iac-bootstrap-home",
  });
  const cliEnv = isolatedCliEnv(tempHome, args.cliDomain);
  try {
    runner({
      command: args.infisicalBin,
      args: ["vault", "set", "file", "--domain", args.cliDomain, "--silent"],
      env: cliEnv,
      capture: true,
    });
    runner({
      command: args.infisicalBin,
      args: ["login", "--domain", args.cliDomain],
      env: cliEnv,
    });
    const stdout = runner({
      command: args.infisicalBin,
      args: ["user", "get", "token", "--plain", "--silent", "--domain", args.cliDomain],
      env: cliEnv,
      capture: true,
    });
    return {
      token: extractToken(stdout),
      cleanupMessage:
        "local Infisical CLI login state was isolated in a temporary HOME and removed; sign out of any browser session manually when appropriate",
      tempHome,
    };
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

export function isolatedCliEnv(tempHome: string, cliDomain: string): NodeJS.ProcessEnv {
  return {
    HOME: tempHome,
    XDG_CONFIG_HOME: path.join(tempHome, ".config"),
    XDG_CACHE_HOME: path.join(tempHome, ".cache"),
    INFISICAL_API_URL: cliDomain,
    INFISICAL_DISABLE_UPDATE_CHECK: "true",
  };
}
