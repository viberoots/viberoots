import path from "node:path";
import process from "node:process";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import { activeViberootsOverride } from "./nix";

export function realizedFinalStoreProbeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const seconds = Number.parseInt(String(env.NIX_PNPM_FETCH_TIMEOUT || "600").trim(), 10);
  return Math.max(30, Number.isFinite(seconds) ? seconds : 600) * 1000;
}

export function finalStoreProbeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = withSanitizedInheritedNixConfig(envWithResolvedNixBin({ ...baseEnv }));
  for (const key of [
    "NIX_PNPM_ALLOW_GENERATE",
    "NIX_PNPM_RECONCILE",
    "NIX_PNPM_MATERIALIZE",
    "NIX_PNPM_EXACT_STORE",
    "NIX_PNPM_EXACT_STORE_INDEX",
    "NIX_PNPM_EXACT_STORE_LOCK_HASH",
  ]) {
    delete env[key];
  }
  return env;
}

export function commandOutput(stdout: string): string {
  return (
    String(stdout || "")
      .trim()
      .split(/\s+/)
      .pop() || ""
  );
}

export function resolveNixStoreBin(env: NodeJS.ProcessEnv): string {
  return String(env.VBR_NIX_STORE_BIN || "").trim() || resolveToolPathSync("nix-store", env);
}

function filteredSnapshotEvalArgs(env: NodeJS.ProcessEnv, flakeRef: string): string[] {
  const markedRoot = String(env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT || "").trim();
  const workspaceRoot = String(env.WORKSPACE_ROOT || "").trim();
  const flakePath = flakeRef.startsWith("path:") ? flakeRef.slice("path:".length) : "";
  if (!markedRoot || !workspaceRoot || !flakePath) return [];
  const root = path.resolve(markedRoot);
  if (path.resolve(workspaceRoot) !== root) return [];
  const flakeDir = path.resolve(flakePath);
  return flakeDir === root || flakeDir.startsWith(`${root}${path.sep}`) ? ["--impure"] : [];
}

export function finalPnpmStoreEvalArgs(
  env: NodeJS.ProcessEnv,
  flakeRef: string,
  attrPath: string,
): string[] {
  return [
    "eval",
    ...filteredSnapshotEvalArgs(env, flakeRef),
    ...activeViberootsOverride(flakeRef, env),
    "--raw",
    "--no-write-lock-file",
    "--accept-flake-config",
    `${flakeRef}#${attrPath}.outPath`,
  ];
}

export function finalPnpmStoreDerivationEvalArgs(
  env: NodeJS.ProcessEnv,
  flakeRef: string,
  attrPath: string,
): string[] {
  return [
    "eval",
    ...filteredSnapshotEvalArgs(env, flakeRef),
    ...activeViberootsOverride(flakeRef, env),
    "--raw",
    "--no-write-lock-file",
    "--accept-flake-config",
    `${flakeRef}#${attrPath}.drvPath`,
  ];
}
