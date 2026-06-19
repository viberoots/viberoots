import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

function cleanEnvPath(value: string | undefined): string {
  return value && value.trim().length > 0 ? path.resolve(value) : "";
}

function parentConsumerRoot(moduleRoot: string): string {
  if (path.basename(moduleRoot) !== "viberoots") return "";
  const parent = path.dirname(moduleRoot);
  const nested = path.join(parent, "viberoots");
  try {
    if (
      fs.existsSync(nested) &&
      fs.realpathSync.native(nested) === fs.realpathSync.native(moduleRoot)
    ) {
      return parent;
    }
  } catch {
    if (fs.existsSync(nested)) return parent;
  }
  return "";
}

export const workspaceRoot =
  cleanEnvPath(process.env.WORKSPACE_ROOT) ||
  cleanEnvPath(process.env._VIBEROOTS_DEVSHELL_ROOT) ||
  parentConsumerRoot(repoRoot) ||
  repoRoot;
export const zxInitPath =
  process.env.ZX_INIT || path.join(repoRoot, "build-tools", "tools", "dev", "zx-init.mjs");

export const lockDir = path.join(workspaceRoot, ".viberoots", "workspace", "buck", "verify-lock");
export const logsDir = path.join(workspaceRoot, ".viberoots", "workspace", "buck", "verify-logs");
export const latestSymlink = path.join(logsDir, "latest.log");
