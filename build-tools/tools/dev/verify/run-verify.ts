import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "zx/globals";
import { runNodeWithZx } from "../../lib/node-run.ts";
import { repoRoot } from "../dev-build/paths.ts";
import { ensureBuckPreludeConfig } from "../dev-build/prelude.ts";
import { runStartupCheck } from "../dev-build/startup.ts";
import { parseVerifyArgs } from "./args.ts";
import { cleanupOrphanBuckDaemons, cleanupRegisteredTempRepos } from "./buck-orphan-cleanup.ts";
import { runMergedCoverageReport, setupCoverage } from "./coverage.ts";
import {
  enforceVerifyDiskGate,
  runVerifyHousekeeping,
  shouldRunNixStoreOptimizeForRequestedTargets,
  verifyTargetFreeGiBDefault,
} from "./housekeeping.ts";
import { runVerifyLintPreflight } from "./lint-preflight.ts";
import { acquireVerifyLock } from "./lock.ts";
import { ensureVerifyPinnedNixpkgs } from "./nix-env.ts";
import { activeNixGcProcesses, logVerifyRevision } from "./preflight.ts";
import { prewarmVerifyOnce } from "./prewarm.ts";
import { cleanupVerifyLegacyPnpmState } from "./pnpm-state.ts";
import { printVerifySelection, resolveRequestedVerifyScope } from "./requested-scope.ts";
import {
  appendVerifyLogLine,
  killBuckIsolation,
  killProcessGroup,
  startBuckDaemonReaper,
  startBuckWatchdog,
  writeVerifyIsoMarker,
} from "./process-control.ts";
import { prepareVerifySeed, shouldPrepareVerifySeedForRequestedTargets } from "./seed.ts";
import { isProjectsOnlyVerifyTargets } from "./target-scope.ts";
import { summarizeTemplateScopeDecision } from "./template-test-scope.ts";
import { ensureRepoLocalTmpRoot } from "./tmp-root.ts";
import { runVerifyBuckPasses } from "./verify-passes.ts";
import { computeZxTestNodeModulesOut } from "./zx-node-modules.ts";

export async function runVerify(): Promise<void> {
  const invocationCwd = process.cwd();
  const root = repoRoot();
  const { args, templateScope } = await resolveRequestedVerifyScope({
    root,
    invocationCwd,
    args: parseVerifyArgs(),
  });
  const zxInitPath = path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
  await ensureVerifyPinnedNixpkgs(root);
  if (args.explainSelection) {
    printVerifySelection(templateScope);
    return;
  }
  await runStartupCheck(root);
  process.chdir(root);
  const projectsOnlyScope = isProjectsOnlyVerifyTargets(templateScope.targets);
  await runVerifyLintPreflight(root, zxInitPath, {
    lintFilters: templateScope.lintFilters,
    includeBuildSystemPolicy: !projectsOnlyScope,
  });
  if (!projectsOnlyScope) {
    await runNodeWithZx({
      cwd: root,
      script: path.join(root, "build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts"),
      args: ["--check"],
      zxInitPath,
    });
  } else {
    process.stderr.write(
      "[verify] template-manifest check: skipped for projects-only verify scope\n",
    );
  }

  const allowConcurrent = process.env.VERIFY_ALLOW_CONCURRENT === "1";
  const lock = await acquireVerifyLock({ root, allowConcurrent });
  await ensureRepoLocalTmpRoot(root);
  await cleanupVerifyLegacyPnpmState(root);
  const analysisDir = path.join(
    root,
    "buck-out",
    "tmp",
    "verify-analysis",
    `run-${process.pid}-${Date.now()}`,
  );
  await fsp.mkdir(analysisDir, { recursive: true }).catch(() => {});
  await fsp.rm(path.join(root, ".tmp"), { recursive: true, force: true }).catch(() => {});
  await ensureBuckPreludeConfig(root);
  process.env.BNX_SHARED_PRELUDE_PATH = path.join(root, "prelude");
  const targetFreeGiB = verifyTargetFreeGiBDefault(args.coverage);
  const runNixStoreOptimize = shouldRunNixStoreOptimizeForRequestedTargets(templateScope.targets);
  const { freeGiB } = await runVerifyHousekeeping({
    root,
    targetFreeGiB,
    zxInitPath,
    runNixStoreOptimize,
  });
  enforceVerifyDiskGate({ freeGiB, targetFreeGiB });
  const cov = await setupCoverage({ root, enabled: args.coverage });
  const iso = `v-${process.pid}-${Date.now()}`;
  const verifyStartS = Math.floor(Date.now() / 1000);
  await writeVerifyIsoMarker(lock.lockDir, iso);
  await appendVerifyLogLine(lock.logFile, `[verify] begin iso=${iso} start_s=${verifyStartS}`);
  const nixGc = await activeNixGcProcesses();
  if (nixGc.length > 0) {
    const sample = nixGc
      .slice(0, 3)
      .map((p) => `${p.pid}:${p.command.slice(0, 120)}`)
      .join(" | ");
    await appendVerifyLogLine(
      lock.logFile,
      `[verify] nix gc preflight warning: active_gc_processes=${nixGc.length} sample=${sample}`,
    );
    process.stderr.write(
      `[verify] WARNING: active 'nix store gc' process(es) detected (${nixGc
        .map((p) => p.pid)
        .join(", ")}); continuing verify with potential contention.\n`,
    );
    process.env.BNX_VERIFY_NIX_GC_DETECTED = "1";
  } else {
    await appendVerifyLogLine(lock.logFile, "[verify] nix gc preflight: ok");
    process.env.BNX_VERIFY_NIX_GC_DETECTED = "0";
  }
  process.env.BNX_VERIFY_NIX_GC_PRECHECK_OK = "1";
  await logVerifyRevision(root, lock.logFile);
  const stateFile = path.join(process.env.TMPDIR || "/tmp", `bucknix-buck-reaper-${iso}.txt`);
  process.env.BNX_BUCK_REAPER_STATE_FILE = stateFile;
  await fsp.writeFile(stateFile, "", "utf8").catch(() => {});
  await startBuckDaemonReaper({ root, zxInitPath, iso, stateFile });
  await startBuckWatchdog({ root, zxInitPath, iso });
  await prewarmVerifyOnce(root, zxInitPath);
  await appendVerifyLogLine(
    lock.logFile,
    `[verify] template scope: ${summarizeTemplateScopeDecision(templateScope)}`,
  );
  await appendVerifyLogLine(
    lock.logFile,
    `[verify] resolved targets: ${templateScope.targets.join(" ")}`,
  );
  if (templateScope.diagnostics) {
    await appendVerifyLogLine(
      lock.logFile,
      `[verify] template scope diagnostics: ${JSON.stringify(templateScope.diagnostics)}`,
    );
  }
  let seedCleanup: (() => Promise<void>) | null = null;
  if (shouldPrepareVerifySeedForRequestedTargets(templateScope.targets)) {
    const seed = await prepareVerifySeed({ root, iso });
    process.env.BNX_TEST_SEED_STORE_PATH = seed.seedPath;
    process.env.BNX_TEST_SEED_KEY = seed.seedKey;
    process.env.BNX_TEST_SEED_PIN_DIR = seed.pinDir;
    seedCleanup = seed.cleanup;
  } else {
    process.stderr.write("[verify] seed build: skipped for scoped verify run\n");
    delete process.env.BNX_TEST_SEED_STORE_PATH;
    delete process.env.BNX_TEST_SEED_KEY;
    delete process.env.BNX_TEST_SEED_PIN_DIR;
  }
  try {
    const res = await cleanupOrphanBuckDaemons({
      log: async (line) => await appendVerifyLogLine(lock.logFile, line),
      maxKills: 50,
    });
    await appendVerifyLogLine(
      lock.logFile,
      `[verify] buck2 orphan cleanup: scanned_forkservers=${res.scanned} candidates=${res.candidates} killed=${res.killed}`,
    );
  } catch {}
  let pgid = process.pid;
  let requestedExitCode: number | null = null;
  let shutdownPromise: Promise<void> | null = null;
  const requestShutdown = (sig: NodeJS.Signals): Promise<void> => {
    requestedExitCode = sig === "SIGINT" ? 130 : 143;
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        if (seedCleanup) {
          await seedCleanup();
          seedCleanup = null;
        }
        await killProcessGroup(pgid);
        await killBuckIsolation(root, iso);
      })();
    }
    return shutdownPromise;
  };
  const signalHandler = (sig: NodeJS.Signals) => void requestShutdown(sig);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    try {
      process.once(sig, () => signalHandler(sig));
    } catch {}
  }
  const zxNodeModulesOut = await computeZxTestNodeModulesOut(root, zxInitPath);
  const status = await runVerifyBuckPasses({
    root,
    iso,
    logFile: lock.logFile,
    console: args.console,
    targets: templateScope.targets,
    zxNodeModulesOut,
    analysisDir,
    onPgid: (nextPgid) => {
      pgid = nextPgid;
    },
  });
  if (shutdownPromise) await shutdownPromise;
  try {
    const res = await cleanupRegisteredTempRepos({
      stateFile,
      log: async (line) => await appendVerifyLogLine(lock.logFile, line),
      maxKills: 200,
    });
    await appendVerifyLogLine(
      lock.logFile,
      `[verify] temp-repo buck cleanup: roots=${res.roots} killed=${res.killed}`,
    );
  } catch {}

  if (process.env.TEST_TIMING === "summary" && lock.logFile) {
    await runNodeWithZx({
      cwd: root,
      script: path.join(root, "build-tools/tools/dev/analyze-verify-timing.ts"),
      args: ["--log", lock.logFile, "--comment"],
      zxInitPath,
      stdio: "pipe",
    }).catch(() => {});
  }
  if (status === 0 && cov.rawDir) await runMergedCoverageReport({ root, rawDir: cov.rawDir });
  if (seedCleanup) {
    await seedCleanup();
    seedCleanup = null;
  }
  await killBuckIsolation(root, iso);
  process.exit(requestedExitCode ?? status);
}
