// `list` subcommand for codex-accounts.
import * as fs from "node:fs";
import * as path from "node:path";

import { getFlagStr } from "../../lib/cli";
import { inspectAccount, legacyRootExists, listAccountDirs, realpathSafe } from "./fs-inspect";
import type { AccountInfo } from "./fs-inspect";
import { renderJson, renderText, toJsonRow, toRow } from "./format";

export async function listAccounts(
  root: string,
  legacyRoot: string,
  current: string,
  format: string,
): Promise<number> {
  if (format !== "text" && format !== "json") {
    process.stderr.write(`error: --format must be text or json (got '${format}')\n`);
    return 2;
  }

  const rootUsable = root.length > 0 && dirExists(root);
  const legacyUsable = legacyRoot.length > 0 && legacyRootExists(legacyRoot);

  if (!rootUsable && !legacyUsable) {
    process.stderr.write(`error: no usable --root or --legacy-root\n`);
    return 3;
  }

  const currentReal = current.length > 0 ? (await realpathSafe(current)) || current : "";

  const infos: Array<{ info: AccountInfo; isDefault: boolean }> = [];

  if (rootUsable) {
    const names = await listAccountDirs(root);
    for (const name of names) {
      const acctPath = path.join(root, name);
      const info = await inspectAccount(acctPath, name);
      const isDefault = currentReal.length > 0 && info.realPath === currentReal;
      infos.push({ info, isDefault });
    }
  }

  if (legacyUsable) {
    const info = await inspectAccount(legacyRoot, "legacy");
    const isDefault = currentReal.length > 0 && info.realPath === currentReal;
    infos.push({ info, isDefault });
  }

  if (format === "json") {
    const rows = infos.map(({ info, isDefault }) => toJsonRow(info, isDefault));
    process.stdout.write(renderJson(rows));
  } else {
    const rows = infos.map(({ info, isDefault }) => toRow(info, isDefault));
    process.stdout.write(renderText(rows));
  }
  return 0;
}

export async function runList(): Promise<number> {
  return await listAccounts(
    getFlagStr("root", ""),
    getFlagStr("legacy-root", ""),
    getFlagStr("current", ""),
    getFlagStr("format", "text") || "text",
  );
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
