import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { validateNamedPath } from "./resolution";
import { confirm, isInteractive } from "./terminal";
import type { WrapperPlan } from "./types";

async function isDefault(root: string, accountPath: string): Promise<boolean> {
  try {
    return (await fsp.realpath(path.join(root, "default"))) === (await fsp.realpath(accountPath));
  } catch {
    return false;
  }
}

async function hasLock(accountPath: string): Promise<boolean> {
  try {
    return (await fsp.stat(path.join(accountPath, ".login.lock"))).isDirectory();
  } catch {
    return false;
  }
}

export async function removeAccount(
  root: string,
  name: string,
  yes: boolean,
): Promise<WrapperPlan> {
  let accountPath: string;
  try {
    accountPath = await validateNamedPath(root, name);
  } catch (error: unknown) {
    process.stderr.write(`${String((error as Error)?.message || error)}\n`);
    return { action: "exit", exitCode: 78 };
  }
  const exists = await fsp
    .stat(accountPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (!exists) {
    process.stderr.write(
      `error: account '${name}' does not exist under ${root}\n` + "  run: codex --list-accounts\n",
    );
    return { action: "exit", exitCode: 78 };
  }
  if (await isDefault(root, accountPath)) {
    process.stderr.write(
      `error: cannot remove '${name}' while it is the default account\n` +
        `  re-point or remove ${path.join(root, "default")} first\n`,
    );
    return { action: "exit", exitCode: 78 };
  }
  const lock = path.join(accountPath, ".login.lock");
  if (await hasLock(accountPath)) {
    process.stderr.write(
      `error: cannot remove '${name}' while a login is in progress (lock: ${lock})\n`,
    );
    return { action: "exit", exitCode: 78 };
  }
  if (!yes && process.env.CODEX_ACCOUNT_REMOVE_YES !== "1") {
    if (!isInteractive()) {
      process.stderr.write(
        "error: --remove-account requires --yes in non-interactive contexts " +
          "(or CODEX_ACCOUNT_REMOVE_YES=1)\n",
      );
      return { action: "exit", exitCode: 2 };
    }
    const accepted = await confirm(
      `Remove account \`${name}\` and all its state under ${accountPath}? [y/N] `,
    );
    if (!accepted) {
      process.stderr.write(`aborted: not removing '${name}'\n`);
      return { action: "exit", exitCode: 0 };
    }
  }
  await fsp.rm(accountPath, { recursive: true, force: false });
  process.stderr.write(`removed account '${name}' (was: ${accountPath})\n`);
  return { action: "exit", exitCode: 0 };
}
