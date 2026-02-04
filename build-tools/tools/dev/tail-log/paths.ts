import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const envWorkspaceRoot = process.env.WORKSPACE_ROOT;
export const workspaceRoot =
  envWorkspaceRoot && envWorkspaceRoot.length > 0 ? envWorkspaceRoot : repoRoot;
export const zxInitPath =
  process.env.ZX_INIT || path.join(repoRoot, "build-tools", "tools", "dev", "zx-init.mjs");

export const lockDir = path.join(workspaceRoot, "buck-out", "tmp", "verify-lock");
export const logsDir = path.join(workspaceRoot, "buck-out", "tmp", "verify-logs");
export const latestSymlink = path.join(logsDir, "latest.log");
