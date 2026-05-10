#!/usr/bin/env zx-wrapper
import { stableBuckIsolation } from "../lib/buck-command-env";
import { normalizeTargetLabel } from "../lib/labels";
import { registerBuckIsolationSync } from "../dev/verify/owned-process-state";

const CONFIG_SUFFIX = /\s+\([^)]*\)$/;

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
    buckEnv.BUCK_ISOLATION_DIR ||
      buckEnv.BUCK_ISOLATION_DIR_EXPORTER ||
      buckEnv.BUCK_NESTED_ISO ||
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
    env.BUCK_ISOLATION_DIR || env.BUCK_ISOLATION_DIR_EXPORTER || env.BUCK_NESTED_ISO || "",
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
