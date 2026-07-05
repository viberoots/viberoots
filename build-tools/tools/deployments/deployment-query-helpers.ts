#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import path from "node:path";
import { stableBuckIsolation } from "../lib/buck-command-env";
import { ensureGraph } from "../buck/glue-run";
import { normalizeTargetLabel } from "../lib/labels";
import { registerBuckIsolationSync } from "../dev/verify/owned-process-state";

const CONFIG_SUFFIX = /\s+\([^)]*\)$/;

export const SUPPORTED_DEPLOYMENT_QUERY_ROOTS = [
  "projects/deployments",
  "projects/apps",
  "projects/libs",
  "sandbox/deployments",
  "sandbox/apps",
  "sandbox/libs",
] as const;

export function deploymentGraphQueryRoots(): string[] {
  return [...SUPPORTED_DEPLOYMENT_QUERY_ROOTS];
}

export function deploymentQueryRootsExpr(workspaceRoot: string): string {
  const roots = deploymentGraphQueryRoots().filter((root) => {
    try {
      return fs.existsSync(path.join(workspaceRoot, root));
    } catch {
      return false;
    }
  });
  if (roots.length === 0) return "set()";
  return `set(${roots.map((root) => `//${root}/...`).join(" ")})`;
}

export async function ensureDeploymentGraph(
  workspaceRoot: string,
  target?: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  await ensureGraph({ workspaceRoot, target, queryRoots: deploymentGraphQueryRoots(), ...opts });
}

export function deploymentBuckEnv(
  workspaceRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const buckEnv: NodeJS.ProcessEnv = {
    ...env,
    HOME: env.BUCK2_REAL_HOME || env.HOME,
    SSL_CERT_FILE: env.SSL_CERT_FILE || env.NIX_SSL_CERT_FILE,
  };
  const inheritedIsolation = String(
    buckEnv.BUCK_ISOLATION_DIR_EXPORTER ||
      buckEnv.BUCK_NESTED_ISO ||
      buckEnv.BUCK_ISOLATION_DIR ||
      "",
  ).trim();
  if (buckEnv.BUCK_NO_ISOLATION !== "1" && !inheritedIsolation && workspaceRoot) {
    buckEnv.BUCK_NESTED_ISO = stableBuckIsolation(workspaceRoot, "deployment-query");
    registerVerifySharedIsolation(
      buckEnv.BUCK_NESTED_ISO,
      workspaceRoot,
      "deployment-query",
      buckEnv,
    );
  }
  return buckEnv;
}

function registerVerifySharedIsolation(
  iso: string,
  repoRoot: string,
  kind: string,
  env: NodeJS.ProcessEnv,
): void {
  const stateFile = String(env.VBR_VERIFY_PROCESS_STATE_FILE || "").trim();
  if (!stateFile || !iso || !repoRoot) return;
  const ownerPidRaw = Number(env.VBR_VERIFY_OWNER_PID || process.pid);
  const ownerPid = Number.isFinite(ownerPidRaw) && ownerPidRaw > 1 ? ownerPidRaw : process.pid;
  try {
    for (const root of Array.from(new Set([repoRoot, process.cwd()]))) {
      registerBuckIsolationSync({ stateFile, iso, repoRoot: root, ownerPid, kind });
    }
  } catch {}
}

export function deploymentIsolationArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.BUCK_NO_ISOLATION === "1") return [];
  const isolationDir = String(
    env.BUCK_ISOLATION_DIR_EXPORTER || env.BUCK_NESTED_ISO || env.BUCK_ISOLATION_DIR || "",
  ).trim();
  return isolationDir ? ["--isolation-dir", isolationDir] : [];
}

export function normalizeQueryTarget(target: string): string {
  const clean = String(target || "")
    .trim()
    .replace(CONFIG_SUFFIX, "");
  return clean.startsWith("root//") ? clean.slice("root".length) : clean;
}

export function queryLabelList(node: Record<string, unknown>, key: string): string[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      typeof entry === "string"
        ? normalizeTargetLabel(entry)
        : entry &&
            typeof entry === "object" &&
            typeof (entry as { label?: unknown }).label === "string"
          ? normalizeTargetLabel(String((entry as { label: string }).label))
          : "",
    )
    .filter(Boolean);
}

export function queryComponentLabels(node: Record<string, unknown>): string[] {
  const value = node.components;
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as { target?: unknown }).target === "string"
        ? normalizeTargetLabel(String((entry as { target: string }).target))
        : "",
    )
    .filter(Boolean);
}
