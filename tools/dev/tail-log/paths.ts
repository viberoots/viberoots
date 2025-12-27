import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
export const workspaceRoot = process.env.WORKSPACE_ROOT || repoRoot;
export const zxInitPath = process.env.ZX_INIT || path.join(repoRoot, "tools", "dev", "zx-init.mjs");

export const lockDir = path.join(workspaceRoot, "buck-out", "tmp", "verify-lock");
export const logsDir = path.join(workspaceRoot, "buck-out", "tmp", "verify-logs");
export const latestSymlink = path.join(logsDir, "latest.log");
