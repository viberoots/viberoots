#!/usr/bin/env zx-wrapper
import { spawnSync } from "node:child_process";
import process from "node:process";
import "./test-helpers/worker-init";

export { getTimingCountForLabel } from "./test-helpers/timing";
export { rsyncRepoTo } from "./test-helpers/rsync";
export { mktemp } from "./test-helpers/tmp";
export { exists } from "./test-helpers/fs";
export { runInScratchTemp, runInTemp, workspaceFlakeRef } from "./test-helpers/run-in-temp";
export {
  buildSelectedOutPath,
  exportGraphInTemp,
  runBuildSelected,
} from "./test-helpers/selected-build";

const ownedBuckIsolations = new Set<string>();
let buckIsolationCleanupRegistered = false;

function cleanupOwnedBuckIsolationsSync(): void {
  for (const isolationDir of ownedBuckIsolations) {
    try {
      spawnSync("buck2", ["--isolation-dir", isolationDir, "kill"], {
        stdio: "ignore",
        env: {
          ...process.env,
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

export function inheritedBuckIsolation(
  defaultIsolation: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const inherited = String(env.BUCK_ISOLATION_DIR || env.BUCK_NESTED_ISO || "").trim();
  if (inherited) return inherited;
  const standalone = String(defaultIsolation || "").trim();
  if (standalone) {
    ownedBuckIsolations.add(standalone);
    ensureBuckIsolationCleanupRegistered();
  }
  return standalone;
}
