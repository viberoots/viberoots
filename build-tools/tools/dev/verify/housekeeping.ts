import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import { emptyDirectoryPreservingMacosMetadataExclusion } from "../../lib/macos-metadata";
import { runNodeWithZx } from "../../lib/node-run";
import { resolveToolPath } from "../../lib/tool-paths";
import { buildToolPath } from "../dev-build/paths";

function parsePositiveInt(s: string | undefined): number | null {
  const n = Number(String(s || "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function verifyTargetFreeGiBDefault(coverage: boolean): number {
  const user = parsePositiveInt(process.env.VERIFY_TARGET_FREE_GB);
  if (user) return user;
  return coverage ? 15 : 20;
}

export async function freeGiBAtPath(root: string): Promise<number> {
  try {
    const { stdout } = await $({ stdio: "pipe", cwd: root })`df -Pk . | tail -n1`;
    const line = String(stdout || "").trim();
    const toks = line.split(/\s+/);
    const availKB = Number(toks[3] || "0");
    return Math.max(0, Math.floor(availKB / 1024 / 1024));
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

async function purgeRepoLocalTemps(root: string): Promise<void> {
  await $({
    stdio: "ignore",
    cwd: root,
  })`bash --noprofile --norc -c 'set -euo pipefail; chmod -R u+w buck-out/tmp .tmp >/dev/null 2>&1 || true; rm -rf buck-out/tmp .tmp >/dev/null 2>&1 || true'`.nothrow();
}

async function runBoundedNixOptimise(root: string, secs: number): Promise<void> {
  const timeoutPath = await resolveToolPath("timeout");
  await $({
    stdio: "ignore",
    cwd: root,
  })`bash --noprofile --norc -c ${`set -euo pipefail
set +e
${timeoutPath} -k 5s ${secs}s nix store optimise >/dev/null 2>&1
exit 0
`}`.nothrow();
}

export function shouldRunNixStoreOptimizeForRequestedTargets(
  _requestedTargets: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.VERIFY_NIX_OPTIMISE || env.VERIFY_NIX_OPTIMIZE || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function runVerifyHousekeeping(opts: {
  root: string;
  targetFreeGiB: number;
  zxInitPath: string;
  runNixStoreOptimize?: boolean;
}): Promise<{ freeGiB: number }> {
  const root = opts.root;
  const target = opts.targetFreeGiB;
  const verbose = isVbrVerbose();
  const ui = createCommandUi({ verbose });

  if (verbose) {
    process.stderr.write(
      "[verify] housekeeping preflight: cleaning temp outs and checking disk space...\n",
    );
  }

  await runNodeWithZx({
    cwd: root,
    script: buildToolPath(root, "tools/dev/clean-temp-outs.ts"),
    args: ["--minutes", "30"],
    zxInitPath: opts.zxInitPath,
    stdio: "pipe",
  }).catch(() => {});

  await emptyDirectoryPreservingMacosMetadataExclusion(
    path.join(root, "buck-out", "test-logs"),
  ).catch(() => {});

  let free = await freeGiBAtPath(root);
  if (verbose) process.stderr.write(`[verify] disk free: ~${free}GiB\n`);

  if (free < 4) {
    process.stderr.write(
      "[verify] very low space (<4GiB): purging repo-local temp dirs (buck-out/tmp, .tmp)...\n",
    );
    await purgeRepoLocalTemps(root);
    free = await freeGiBAtPath(root);
    process.stderr.write(`[verify] after purge: ~${free}GiB\n`);
  }

  if (opts.runNixStoreOptimize === true) {
    if (!verbose) ui.step("housekeeping", "optimising nix store");
    await runBoundedNixOptimise(root, 60);
    free = await freeGiBAtPath(root);
  } else {
    if (verbose)
      process.stderr.write("[verify] housekeeping: skipping nix store optimise by default\n");
  }

  if (free < target) {
    process.stderr.write(
      "[verify] low disk free detected; skipping automatic Nix GC during verify. Run maintenance GC outside verify if more store space is needed.\n",
    );
  }

  return { freeGiB: free };
}

export const VERIFY_DISK_GATE_EXIT_CODE = 2;

export function computeVerifyDiskGateFailure(opts: {
  freeGiB: number;
  targetFreeGiB: number;
}): string | null {
  if (opts.freeGiB >= opts.targetFreeGiB) return null;
  return (
    `error: verify refused to start due to low disk free space.\n` +
    `need: >=${opts.targetFreeGiB}GiB\n` +
    `have: ~${opts.freeGiB}GiB\n` +
    `hint: try freeing space (repo temp outs, nix-store --gc), or override threshold via VERIFY_TARGET_FREE_GB.\n`
  );
}

export function enforceVerifyDiskGate(opts: { freeGiB: number; targetFreeGiB: number }): void {
  const msg = computeVerifyDiskGateFailure(opts);
  if (!msg) return;
  process.stderr.write(msg);
  process.exit(VERIFY_DISK_GATE_EXIT_CODE);
}
