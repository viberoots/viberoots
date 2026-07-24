import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { inspectAuthentication } from "./auth-state";
import { ensureNamedAccountDirectory } from "./resolution";
import { confirm, isInteractive } from "./terminal";
import type { ParsedAccountArgs, Resolution, WrapperPlan } from "./types";

async function withLoginLock<T>(accountPath: string, work: () => Promise<T>): Promise<T> {
  const lock = path.join(accountPath, ".login.lock");
  try {
    await fsp.mkdir(lock);
  } catch {
    process.stderr.write(
      `error: another codex login is in progress (lock: ${lock})\n` +
        `  if no other codex is running, remove the lock: rmdir ${lock}\n`,
    );
    return { action: "exit", exitCode: 75 } as T;
  }
  const cleanup = (): void => {
    try {
      fs.rmdirSync(lock);
    } catch {}
  };
  const onInterrupt = (): never => {
    cleanup();
    process.exit(130);
  };
  const onTerminate = (): never => {
    cleanup();
    process.exit(143);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    return await work();
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    cleanup();
  }
}

function runUpstreamLogin(realCodex: string, codexHome: string, args: string[]): number {
  const result = spawnSync(realCodex, args, {
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: "inherit",
  });
  if (result.error) {
    process.stderr.write(`error: failed to launch managed codex login: ${result.error.message}\n`);
    return 69;
  }
  if (typeof result.status === "number") return result.status;
  return result.signal === "SIGINT" ? 130 : result.signal === "SIGTERM" ? 143 : 1;
}

async function maybeSetFirstDefault(root: string, name: string): Promise<void> {
  const link = path.join(root, "default");
  try {
    await fsp.lstat(link);
    return;
  } catch {}
  if (!isInteractive() || !(await confirm(`Set \`${name}\` as the default account? [y/N] `)))
    return;
  await fsp.symlink(name, link);
}

export async function applyLoginLifecycle(input: {
  parsed: ParsedAccountArgs;
  resolution: Resolution;
  root: string;
  realCodex: string;
  originalArgs: string[];
}): Promise<WrapperPlan | null> {
  const { parsed, resolution, root, realCodex, originalArgs } = input;
  let codexHome = resolution.codexHome;
  if (parsed.command === "login") {
    if (process.env.VBR_CODEX_SAFEHOUSE_ACTIVE === "1") {
      process.stderr.write(
        "error: codex login cannot run from inside an active Safehouse\n" +
          "  exit the sandboxed session and rerun the login command from the host dev shell\n",
      );
      return { action: "exit", exitCode: 77 };
    }
    if (!codexHome || !realCodex) {
      process.stderr.write("error: codex login requires a resolved account and managed Codex\n");
      return { action: "exit", exitCode: 69 };
    }
    if (resolution.accountName) {
      codexHome = await ensureNamedAccountDirectory(root, resolution.accountName);
    } else {
      await fsp.mkdir(codexHome, { recursive: true });
    }
    return await withLoginLock(codexHome, async () => ({
      action: "exit",
      exitCode: runUpstreamLogin(realCodex, codexHome, parsed.strippedArgs),
    }));
  }

  if (!resolution.accountName || !codexHome) return null;
  const auth = await inspectAuthentication(codexHome);
  if (auth.usable) return null;
  if (process.env.VBR_CODEX_SAFEHOUSE_ACTIVE === "1") {
    process.stderr.write(
      "error: codex account initialization cannot run from inside an active Safehouse\n" +
        "  exit the sandboxed session and rerun the command from the host dev shell\n",
    );
    return { action: "exit", exitCode: 77 };
  }

  const existed = await fsp
    .stat(codexHome)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  const initAllowed = parsed.accountInit || process.env.CODEX_ACCOUNT_INIT === "1";
  if (!existed && !initAllowed) {
    if (!isInteractive()) {
      process.stderr.write(
        `error: codex account '${resolution.accountName}' does not exist under ${root}\n` +
          "  run interactively to create it, or pass --account-init (or set CODEX_ACCOUNT_INIT=1)\n",
      );
      return { action: "exit", exitCode: 66 };
    }
    if (
      !(await confirm(
        `Account \`${resolution.accountName}\` does not exist under ${root}. Create it? [y/N] `,
      ))
    ) {
      return { action: "exit", exitCode: 0 };
    }
  }
  if (!realCodex) {
    process.stderr.write("error: guided login requires the viberoots-managed Codex binary\n");
    return { action: "exit", exitCode: 69 };
  }
  if (!existed) {
    codexHome = await ensureNamedAccountDirectory(root, resolution.accountName);
  }

  return await withLoginLock(codexHome, async () => {
    const status = runUpstreamLogin(realCodex, codexHome, ["login"]);
    const authenticated = status === 0 && (await inspectAuthentication(codexHome)).usable;
    if (!authenticated) {
      if (!existed) await fsp.rm(codexHome, { recursive: true, force: true });
      process.stderr.write(
        `error: guided login failed for account '${resolution.accountName}' (codex login exit=${status})\n`,
      );
      return { action: "exit", exitCode: 67 };
    }
    if (!existed) await maybeSetFirstDefault(root, resolution.accountName || "");
    return { action: "reexec", args: originalArgs };
  });
}
