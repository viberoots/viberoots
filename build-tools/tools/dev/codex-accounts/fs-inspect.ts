import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { inspectAuthentication } from "./auth-state";
import { isValidAccountName } from "./name";
import type { AuthMode } from "./types";

export type AccountInfo = {
  name: string;
  path: string;
  realPath: string;
  auth: AuthMode;
  email: string | null;
  expired: boolean | null;
};

export async function realpathSafe(p: string): Promise<string | null> {
  try {
    return await fsp.realpath(p);
  } catch {
    return null;
  }
}

export async function listAccountDirs(root: string): Promise<string[]> {
  try {
    const rootStat = await fsp.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];
    const rootReal = await fsp.realpath(root);
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      if (!isValidAccountName(e.name)) continue;
      const full = path.join(root, e.name);
      const real = await realpathSafe(full);
      if (!real || path.dirname(real) !== rootReal || path.basename(real) !== e.name) continue;
      if ((await fsp.stat(real)).isDirectory()) out.push(e.name);
    }
    out.sort();
    return out;
  } catch {
    return [];
  }
}

export async function inspectAccount(
  accountPath: string,
  displayName: string,
): Promise<AccountInfo> {
  const real = (await realpathSafe(accountPath)) || accountPath;
  const auth = await inspectAuthentication(accountPath);
  return {
    name: displayName,
    path: accountPath,
    realPath: real,
    auth: auth.mode,
    email: auth.email,
    expired: auth.expired,
  };
}

export function legacyRootExists(legacyRoot: string): boolean {
  try {
    const s = fs.statSync(legacyRoot);
    return s.isDirectory();
  } catch {
    return false;
  }
}
