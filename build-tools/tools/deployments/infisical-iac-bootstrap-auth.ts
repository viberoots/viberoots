import * as fs from "node:fs/promises";
import * as syncFs from "node:fs";
import * as path from "node:path";
import { spawnSync as defaultSpawnSync } from "node:child_process";
import type { BootstrapArgs, CommandRunner } from "./infisical-iac-bootstrap-types";
import { scrubControlPlaneChildEnv } from "./control-plane-process-env";
import { mkdtempNoindex } from "../lib/macos-metadata";

type SpawnSyncImpl = typeof defaultSpawnSync;

export function createSpawnCommandRunner(
  deps: {
    spawnSync?: SpawnSyncImpl;
    openSync?: typeof syncFs.openSync;
    closeSync?: typeof syncFs.closeSync;
  } = {},
): CommandRunner {
  const spawnSync = deps.spawnSync || defaultSpawnSync;
  const openSync = deps.openSync || syncFs.openSync;
  const closeSync = deps.closeSync || syncFs.closeSync;
  return (opts) => {
    let ttyFd: number | undefined;
    let ttyMode: string | undefined;
    const stdio = (() => {
      if (opts.capture) return ["inherit", "pipe", "pipe"] as const;
      if (!opts.tty) return "inherit" as const;
      try {
        ttyFd = openSync("/dev/tty", "r+");
        ttyMode = readTtyMode(spawnSync, ttyFd);
        return [ttyFd, ttyFd, ttyFd] as const;
      } catch (error) {
        throw new Error(
          `command ${opts.command} requires an interactive terminal, but /dev/tty is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();
    let result: ReturnType<SpawnSyncImpl>;
    try {
      if (opts.tty) pauseParentStdinForInteractiveChild();
      result = spawnSync(opts.command, opts.args, {
        cwd: opts.cwd,
        env: scrubControlPlaneChildEnv(opts.env),
        encoding: "utf8",
        stdio,
      });
    } finally {
      if (ttyFd !== undefined) {
        restoreTtyMode(spawnSync, ttyFd, ttyMode);
        closeSync(ttyFd);
      }
    }
    if (result.error) throw commandSpawnError(opts.command, result.error);
    if (result.status !== 0) {
      const stderr = opts.capture && result.stderr ? `\n${result.stderr.trim()}` : "";
      throw new Error(
        `${opts.command} ${opts.args.join(" ")} failed with exit ${result.status}${stderr}`,
      );
    }
    return result.stdout ?? "";
  };
}

export const spawnCommandRunner: CommandRunner = createSpawnCommandRunner();

function readTtyMode(spawnSync: SpawnSyncImpl, ttyFd: number) {
  const result = spawnSync("stty", ["-g"], {
    encoding: "utf8",
    stdio: [ttyFd, "pipe", "ignore"],
  });
  return result.status === 0 ? String(result.stdout || "").trim() || undefined : undefined;
}

function pauseParentStdinForInteractiveChild() {
  if (process.stdin.isTTY && typeof process.stdin.pause === "function") process.stdin.pause();
}

function restoreTtyMode(spawnSync: SpawnSyncImpl, ttyFd: number, ttyMode: string | undefined) {
  if (!ttyMode) return;
  spawnSync("stty", [ttyMode], {
    encoding: "utf8",
    stdio: [ttyFd, "ignore", "ignore"],
  });
}

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
    console.error(loginWaitMessage(args));
    try {
      runner({
        command: args.infisicalBin,
        args: [
          "login",
          "--domain",
          args.cliDomain,
          ...(args.loginMode === "interactive" ? ["--interactive"] : []),
        ],
        env: cliEnv,
        tty: true,
      });
    } catch (error) {
      throw loginFailureMessage(args, error);
    }
    console.error("[infisical-bootstrap] Infisical CLI login complete; reading access token");
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

function loginFailureMessage(args: BootstrapArgs, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (args.loginMode !== "browser" || !/unexpected end of JSON input/i.test(message)) {
    return error;
  }
  return new Error(
    [
      "Infisical browser login did not complete.",
      "Wait for the browser page to report success; do not press Enter at the CLI Token prompt unless the browser gives you a token to paste.",
      "Rerun with `i --infisical-login-mode interactive` if browser callback login keeps failing.",
      `Original Infisical CLI error: ${message}`,
    ].join("\n"),
  );
}

function loginWaitMessage(args: BootstrapArgs) {
  if (args.loginMode === "interactive") {
    return [
      `[infisical-bootstrap] waiting for command-line Infisical login at ${args.cliDomain}.`,
      "Complete the prompts in this terminal.",
      `For token-based automation, rerun with --no-login --access-token-env ${args.accessTokenEnv} and --org-name or --organization-id.`,
    ].join(" ");
  }
  return [
    `[infisical-bootstrap] waiting for Infisical CLI browser login at ${args.cliDomain}.`,
    "Complete the browser/login flow if one opens.",
    "If the wrong browser opens or no browser tab opens, press Ctrl-C and rerun with `i --infisical-login-mode interactive` or lower-level `--login-mode interactive`.",
    `For token-based automation, rerun with --no-login --access-token-env ${args.accessTokenEnv} and --org-name or --organization-id.`,
  ].join(" ");
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
