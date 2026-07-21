#!/usr/bin/env zx-wrapper
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { registerBuckIsolationSync } from "../../dev/verify/owned-process-state";
import "./test-helpers/worker-init";

export { getTimingCountForLabel } from "./test-helpers/timing";
export { rsyncRepoTo } from "./test-helpers/rsync";
export { mktemp } from "./test-helpers/tmp";
export { exists } from "./test-helpers/fs";
export {
  reconcileTempDependencyInputs,
  runInScratchTemp,
  runInTemp,
  workspaceFlakeRef,
} from "./test-helpers/run-in-temp";
export {
  buildSelectedOutPath,
  exportGraphInTemp,
  runBuildSelected,
} from "./test-helpers/selected-build";
export { publicBuildOutPath, runPublicBuild } from "./test-helpers/public-build";

const ownedBuckIsolations = new Map<string, string>();
let buckIsolationCleanupRegistered = false;

function cleanupOwnedBuckIsolationsSync(): void {
  for (const [isolationDir, repoRoot] of ownedBuckIsolations) {
    try {
      spawnSync("buck2", ["--isolation-dir", isolationDir, "kill"], {
        cwd: repoRoot,
        stdio: "ignore",
        env: {
          ...process.env,
          WORKSPACE_ROOT: repoRoot,
          HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
          SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
        },
      });
    } catch {}
  }
}

function ensureBuckIsolationCleanupRegistered(): void {
  if (buckIsolationCleanupRegistered) return;
  buckIsolationCleanupRegistered = true;
  process.once("exit", cleanupOwnedBuckIsolationsSync);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      cleanupOwnedBuckIsolationsSync();
      process.exit(128);
    });
  }
}

function currentBuckRepoRoot(env: NodeJS.ProcessEnv): string {
  return path.resolve(String(env.WORKSPACE_ROOT || env.BUCK_TEST_SRC || process.cwd()).trim());
}

function registerOwnedBuckIsolation(isolationDir: string, env: NodeJS.ProcessEnv): void {
  const repoRoot = currentBuckRepoRoot(env);
  ownedBuckIsolations.set(isolationDir, repoRoot);
  ensureBuckIsolationCleanupRegistered();

  const stateFile = String(
    env.VBR_VERIFY_PROCESS_STATE_FILE || env.VBR_BUCK_REAPER_STATE_FILE || "",
  ).trim();
  if (!stateFile) return;
  const ownerPidRaw = Number(env.VBR_VERIFY_OWNER_PID || process.pid);
  const ownerPid = Number.isFinite(ownerPidRaw) && ownerPidRaw > 1 ? ownerPidRaw : process.pid;
  try {
    registerBuckIsolationSync({
      stateFile,
      iso: isolationDir,
      repoRoot,
      ownerPid,
      kind: "test-helper-inherited-default",
    });
  } catch {}
}

export function inheritedBuckIsolation(
  defaultIsolation: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const inherited = String(env.BUCK_ISOLATION_DIR || env.BUCK_NESTED_ISO || "").trim();
  if (inherited) return inherited;
  const standalone = String(defaultIsolation || "").trim();
  if (standalone) {
    registerOwnedBuckIsolation(standalone, env);
  }
  return standalone;
}

export function envWithStubbedNix(
  binDir: string,
  extraEnv: NodeJS.ProcessEnv = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...extraEnv,
  };
  env.PATH = `${binDir}${path.delimiter}${env.PATH || ""}`;
  const nixBin = path.join(binDir, "nix");
  env.VBR_NIX_BIN = nixBin;
  env.NIX_BIN = nixBin;
  return env;
}

export function envWithoutSelectedNix(
  extraEnv: NodeJS.ProcessEnv = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...extraEnv,
  };
  delete env.VBR_NIX_BIN;
  delete env.NIX_BIN;
  return env;
}
