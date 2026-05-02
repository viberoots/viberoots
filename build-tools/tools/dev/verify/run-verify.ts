import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "zx/globals";
import { repoRoot } from "../dev-build/paths.ts";
import { ensureBuckPreludeConfig } from "../dev-build/prelude.ts";
import { runStartupCheck } from "../dev-build/startup.ts";
import { parseVerifyArgs } from "./args.ts";
import { cleanupOrphanBuckDaemons } from "./buck-orphan-cleanup.ts";
import { runMergedCoverageReport, setupCoverage } from "./coverage.ts";
import { runExplainSelection } from "./explain-selection.ts";
import {
  enforceVerifyDiskGate,
  runVerifyHousekeeping,
  shouldRunNixStoreOptimizeForRequestedTargets,
  verifyTargetFreeGiBDefault,
} from "./housekeeping.ts";
import { runVerifyLintPreflight } from "./lint-preflight.ts";
import { acquireVerifyLock } from "./lock.ts";
import { ensureVerifyPinnedNixpkgs } from "./nix-env.ts";
import { recordNixGcPreflight } from "./nix-gc-preflight.ts";
import { createVerifyPhaseTimer } from "./phase-timing.ts";
import { logVerifyRevision } from "./preflight.ts";
import { prewarmVerifyOnce } from "./prewarm.ts";
import { cleanupVerifyLegacyPnpmState } from "./pnpm-state.ts";
import { resolveRequestedVerifyScope } from "./requested-scope.ts";
import { summarizeVerifyScopeDecision } from "./selection-output.ts";
import { createRegisteredStateCleaner } from "./registered-state-cleanup.ts";
import {
  appendVerifyLogLine,
  killBuckIsolation,
  killProcessGroup,
  startBuckDaemonReaper,
  startBuckWatchdog,
  writeVerifyIsoMarker,
} from "./process-control.ts";
import { prepareVerifySeed, shouldPrepareVerifySeedForRequestedTargets } from "./seed.ts";
import { isNonBuildSystemOnlyVerifyTargets } from "./target-scope.ts";
import {
  maybeWriteVerifyTimingSummary,
  runTemplateManifestCheck,
} from "./template-manifest-check.ts";
import { ensureRepoLocalTmpRoot } from "./tmp-root.ts";
import { runVerifyBuckPasses } from "./verify-passes.ts";
import { computeZxTestNodeModulesOut } from "./zx-node-modules.ts";

export async function runVerify(): Promise<void> {
  const phaseTimer = createVerifyPhaseTimer({ appendLine: appendVerifyLogLine });
  const timedPhase = phaseTimer.timedPhase;
  const invocationCwd = process.cwd();
  const root = repoRoot();
  const { args, selection } = await resolveRequestedVerifyScope({
    root,
    invocationCwd,
    args: parseVerifyArgs(),
  });
  const zxInitPath = path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
  await timedPhase("ensure-pinned-nixpkgs", async () => await ensureVerifyPinnedNixpkgs(root));
  if (args.explainSelection) {
    await runExplainSelection({ root, selection });
    return;
  }
  await timedPhase("startup-check", async () => await runStartupCheck(root));
  process.chdir(root);
  const nonBuildSystemOnlyScope = isNonBuildSystemOnlyVerifyTargets(selection.targets);
  await timedPhase(
    "lint-preflight",
    async () =>
      await runVerifyLintPreflight(root, zxInitPath, {
        lintFilters: selection.lintFilters,
        includeBuildSystemPolicy: !nonBuildSystemOnlyScope,
      }),
  );
  await timedPhase(
    "template-manifest-check",
    async () => await runTemplateManifestCheck({ root, zxInitPath, nonBuildSystemOnlyScope }),
  );

  const allowConcurrent = process.env.VERIFY_ALLOW_CONCURRENT === "1";
  const lock = await timedPhase(
    "acquire-verify-lock",
    async () => await acquireVerifyLock({ root, allowConcurrent }),
  );
  await phaseTimer.setLogFile(lock.logFile);
  await timedPhase("ensure-repo-local-tmp-root", async () => await ensureRepoLocalTmpRoot(root));
  await timedPhase(
    "cleanup-legacy-pnpm-state",
    async () => await cleanupVerifyLegacyPnpmState(root),
  );
  const analysisDir = path.join(
    root,
    "buck-out",
    "tmp",
    "verify-analysis",
    `run-${process.pid}-${Date.now()}`,
  );
  await fsp.mkdir(analysisDir, { recursive: true }).catch(() => {});
  await fsp.rm(path.join(root, ".tmp"), { recursive: true, force: true }).catch(() => {});
  await timedPhase("ensure-buck-prelude-config", async () => await ensureBuckPreludeConfig(root));
  process.env.BNX_SHARED_PRELUDE_PATH = path.join(root, "prelude");
  const targetFreeGiB = verifyTargetFreeGiBDefault(args.coverage);
  const runNixStoreOptimize = shouldRunNixStoreOptimizeForRequestedTargets(selection.targets);
  const { freeGiB } = await timedPhase(
    "housekeeping",
    async () =>
      await runVerifyHousekeeping({
        root,
        targetFreeGiB,
        zxInitPath,
        runNixStoreOptimize,
      }),
  );
  enforceVerifyDiskGate({ freeGiB, targetFreeGiB });
  const cov = await timedPhase(
    "setup-coverage",
    async () => await setupCoverage({ root, enabled: args.coverage }),
  );
  const iso = `v-${process.pid}-${Date.now()}`;
  const verifyStartS = Math.floor(Date.now() / 1000);
  await writeVerifyIsoMarker(lock.lockDir, iso);
  await appendVerifyLogLine(lock.logFile, `[verify] begin iso=${iso} start_s=${verifyStartS}`);
  await timedPhase("nix-gc-preflight", async () => await recordNixGcPreflight(lock.logFile));
  await timedPhase("log-verify-revision", async () => await logVerifyRevision(root, lock.logFile));
  const stateFile = path.join(process.env.TMPDIR || "/tmp", `bucknix-buck-reaper-${iso}.txt`);
  process.env.BNX_BUCK_REAPER_STATE_FILE = stateFile;
  process.env.BNX_VERIFY_PROCESS_STATE_FILE = stateFile;
  await fsp.writeFile(stateFile, "", "utf8").catch(() => {});
  await timedPhase(
    "start-buck-daemon-reaper",
    async () => await startBuckDaemonReaper({ root, zxInitPath, iso, stateFile }),
  );
  await timedPhase(
    "start-buck-watchdog",
    async () => await startBuckWatchdog({ root, zxInitPath, iso, logFile: lock.logFile }),
  );
  await timedPhase("prewarm-verify", async () => await prewarmVerifyOnce(root, zxInitPath));
  await appendVerifyLogLine(
    lock.logFile,
    `[verify] selection: ${summarizeVerifyScopeDecision(selection)}`,
  );
  await appendVerifyLogLine(
    lock.logFile,
    `[verify] resolved targets: ${selection.targets.join(" ")}`,
  );
  if (selection.diagnostics) {
    await appendVerifyLogLine(
      lock.logFile,
      `[verify] selection diagnostics: ${JSON.stringify(selection.diagnostics)}`,
    );
  }
  let seedCleanup: (() => Promise<void>) | null = null;
  if (shouldPrepareVerifySeedForRequestedTargets(selection.targets)) {
    const seed = await timedPhase(
      "prepare-verify-seed",
      async () => await prepareVerifySeed({ root, iso }),
    );
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
    const res = await timedPhase(
      "cleanup-orphan-buck-daemons",
      async () =>
        await cleanupOrphanBuckDaemons({
          log: async (line) => await appendVerifyLogLine(lock.logFile, line),
          maxKills: 50,
        }),
    );
    await appendVerifyLogLine(
      lock.logFile,
      `[verify] buck2 orphan cleanup: scanned_forkservers=${res.scanned} candidates=${res.candidates} killed=${res.killed}`,
    );
  } catch {}
  const activePgids = new Set<number>();
  let requestedExitCode: number | null = null;
  let shutdownPromise: Promise<void> | null = null;
  const cleanupRegisteredTempRepoState = createRegisteredStateCleaner({
    stateFile,
    logFile: lock.logFile,
  });
  let shutdownLogged = false;
  const requestShutdown = (sig: NodeJS.Signals): Promise<void> => {
    requestedExitCode = sig === "SIGINT" ? 130 : 143;
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        if (!shutdownLogged) {
          shutdownLogged = true;
          await appendVerifyLogLine(
            lock.logFile,
            `[verify] stopped signal=${sig} end_s=${Math.floor(Date.now() / 1000)}`,
          );
        }
        if (seedCleanup) {
          await seedCleanup();
          seedCleanup = null;
        }
        const pgids = activePgids.size > 0 ? [...activePgids] : [process.pid];
        await Promise.all(pgids.map(async (pgid) => await killProcessGroup(pgid)));
        await killBuckIsolation(root, iso);
        await cleanupRegisteredTempRepoState();
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
  const zxNodeModulesOut = await timedPhase(
    "compute-zx-test-node-modules",
    async () => await computeZxTestNodeModulesOut(root, zxInitPath),
  );
  const status = await timedPhase(
    "buck-test-passes",
    async () =>
      await runVerifyBuckPasses({
        root,
        iso,
        logFile: lock.logFile,
        console: args.console,
        targets: selection.targets,
        zxNodeModulesOut,
        analysisDir,
        onPgid: (nextPgid) => activePgids.add(nextPgid),
        onPgidDone: (donePgid) => activePgids.delete(donePgid),
      }),
  );
  if (shutdownPromise) await shutdownPromise;
  await cleanupRegisteredTempRepoState();

  await maybeWriteVerifyTimingSummary({ root, logFile: lock.logFile, zxInitPath });
  if (status === 0 && cov.rawDir) await runMergedCoverageReport({ root, rawDir: cov.rawDir });
  if (seedCleanup) {
    await timedPhase("seed-cleanup", async () => await seedCleanup?.());
    seedCleanup = null;
  }
  await timedPhase("kill-verify-buck-isolation", async () => await killBuckIsolation(root, iso));
  process.exit(requestedExitCode ?? status);
}
