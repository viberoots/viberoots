import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "zx/globals";
import { isRemoteVerifyPolicy, shouldComputeLocalZxTestNodeModules } from "./remote-policy";
import { defaultRunVerifyDeps, type RunVerifyDeps } from "./run-verify-deps";

export async function runVerify(): Promise<void> {
  await runVerifyWithDeps(defaultRunVerifyDeps);
}

export async function runVerifyWithDeps(overrides: Partial<RunVerifyDeps> = {}): Promise<void> {
  const deps = { ...defaultRunVerifyDeps, ...overrides };
  const phaseTimer = deps.createVerifyPhaseTimer({ appendLine: deps.appendVerifyLogLine });
  const timedPhase = phaseTimer.timedPhase;
  const invocationCwd = process.cwd();
  const root = deps.repoRoot();
  const parsedArgs = deps.parseVerifyArgs();
  const executionPolicy = deps.parseVerifyExecutionPolicyForArgs({ args: parsedArgs });
  const remoteVerify = isRemoteVerifyPolicy(executionPolicy);
  const { iso, stateFile } = await deps.initializeVerifyProcessState(root);
  let cleanupRegisteredTempRepoState = deps.createRegisteredStateCleaner({
    stateFile,
    logFile: null,
  });
  const cleanupEarlyFailure = async (error: unknown): Promise<never> => {
    await cleanupRegisteredTempRepoState();
    throw error;
  };
  const { args, selection } = await deps
    .resolveRequestedVerifyScope({
      root,
      invocationCwd,
      args: parsedArgs,
    })
    .catch(cleanupEarlyFailure);
  const zxInitPath = path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
  await timedPhase("ensure-pinned-nixpkgs", async () => await deps.ensureVerifyPinnedNixpkgs(root));
  if (args.explainSelection) {
    await deps.runExplainSelection({ root, selection, executionPolicy });
    await deps.createRegisteredStateCleaner({ stateFile, logFile: null })();
    return;
  }
  if (!remoteVerify) {
    await timedPhase("startup-check", async () => await deps.runStartupCheck(root));
  }
  deps.chdir(root);
  const nonBuildSystemOnlyScope = deps.isNonBuildSystemOnlyVerifyTargets(selection.targets);
  await timedPhase(
    "lint-preflight",
    async () =>
      await deps.runVerifyLintPreflight(root, zxInitPath, {
        lintFilters: selection.lintFilters,
        includeBuildSystemPolicy: !nonBuildSystemOnlyScope,
      }),
  ).catch(cleanupEarlyFailure);
  await timedPhase(
    "template-manifest-check",
    async () => await deps.runTemplateManifestCheck({ root, zxInitPath, nonBuildSystemOnlyScope }),
  ).catch(cleanupEarlyFailure);
  const allowConcurrent = process.env.VERIFY_ALLOW_CONCURRENT === "1";
  const lock = await timedPhase(
    "acquire-verify-lock",
    async () => await deps.acquireVerifyLock({ root, allowConcurrent }),
  ).catch(cleanupEarlyFailure);
  await phaseTimer.setLogFile(lock.logFile);
  cleanupRegisteredTempRepoState = deps.createRegisteredStateCleaner({
    stateFile,
    logFile: lock.logFile,
  });
  await timedPhase(
    "ensure-repo-local-tmp-root",
    async () => await deps.ensureRepoLocalTmpRoot(root),
  );
  if (!remoteVerify) {
    await timedPhase(
      "cleanup-stale-pnpm-state",
      async () => await deps.cleanupVerifyLegacyPnpmState(root),
    );
  }
  const analysisDir = path.join(
    root,
    "buck-out",
    "tmp",
    "verify-analysis",
    `run-${process.pid}-${Date.now()}`,
  );
  await fsp.mkdir(analysisDir, { recursive: true }).catch(() => {});
  await fsp.rm(path.join(root, ".tmp"), { recursive: true, force: true }).catch(() => {});
  await timedPhase(
    "ensure-buck-prelude-config",
    async () => await deps.ensureBuckPreludeConfig(root),
  );
  process.env.VBR_SHARED_PRELUDE_PATH = path.join(root, "prelude");
  const cov = remoteVerify
    ? { rawDir: null }
    : await timedPhase("setup-local-workspace", async () => {
        return await deps.setupLocalVerifyWorkspace({
          root,
          zxInitPath,
          coverage: args.coverage,
          targets: selection.targets,
        });
      });
  const verifyStartS = Math.floor(Date.now() / 1000);
  await deps.writeVerifyIsoMarker(lock.lockDir, iso);
  await deps.appendVerifyLogLine(lock.logFile, `[verify] begin iso=${iso} start_s=${verifyStartS}`);
  await timedPhase("nix-gc-preflight", async () => await deps.recordNixGcPreflight(lock.logFile));
  await timedPhase(
    "log-verify-revision",
    async () => await deps.logVerifyRevision(root, lock.logFile),
  );
  if (!remoteVerify) {
    await timedPhase(
      "start-buck-daemon-reaper",
      async () => await deps.startBuckDaemonReaper({ root, zxInitPath, iso, stateFile }),
    );
    await timedPhase(
      "start-buck-watchdog",
      async () => await deps.startBuckWatchdog({ root, zxInitPath, iso, logFile: lock.logFile }),
    );
    await timedPhase("prewarm-verify", async () => await deps.prewarmVerifyOnce(root, zxInitPath));
  }
  await deps.appendVerifyLogLine(
    lock.logFile,
    `[verify] selection: ${deps.summarizeVerifyScopeDecision(selection)}`,
  );
  await deps.appendVerifyLogLine(
    lock.logFile,
    `[verify] resolved targets: ${selection.targets.join(" ")}`,
  );
  if (selection.diagnostics) {
    await deps.appendVerifyLogLine(
      lock.logFile,
      `[verify] selection diagnostics: ${JSON.stringify(selection.diagnostics)}`,
    );
  }
  let seedCleanup: (() => Promise<void>) | null = null;
  if (remoteVerify && deps.shouldPrepareVerifySeedForRequestedTargets(selection.targets)) {
    const seed = await timedPhase(
      "prepare-verify-seed-remote-ready",
      async () => await deps.prepareVerifySeed({ root, iso, mode: "remote-ready" }),
    );
    process.env.VBR_TEST_SEED_STORE_PATH = seed.seedPath;
    process.env.VBR_TEST_SEED_KEY = seed.seedKey;
    if (seed.remoteManifestPath) {
      process.env.VBR_TEST_SEED_REMOTE_MANIFEST = seed.remoteManifestPath;
    } else {
      delete process.env.VBR_TEST_SEED_REMOTE_MANIFEST;
    }
  } else if (!remoteVerify && deps.shouldPrepareVerifySeedForRequestedTargets(selection.targets)) {
    const seed = await timedPhase(
      "prepare-verify-seed",
      async () => await deps.prepareVerifySeed({ root, iso }),
    );
    process.env.VBR_TEST_SEED_STORE_PATH = seed.seedPath;
    process.env.VBR_TEST_SEED_KEY = seed.seedKey;
    process.env.VBR_TEST_SEED_PIN_DIR = seed.pinDir;
    seedCleanup = seed.cleanup;
  } else {
    process.stderr.write("[verify] seed build: skipped for scoped verify run\n");
    delete process.env.VBR_TEST_SEED_STORE_PATH;
    delete process.env.VBR_TEST_SEED_KEY;
    delete process.env.VBR_TEST_SEED_PIN_DIR;
    delete process.env.VBR_TEST_SEED_REMOTE_MANIFEST;
  }
  if (!remoteVerify) {
    await timedPhase(
      "cleanup-orphan-buck-daemons",
      async () => await deps.cleanupLocalOrphanBuckDaemons(lock.logFile),
    );
  }
  const activePgids = new Set<number>();
  const activeNestedIsos = new Set<string>();
  let requestedExitCode: number | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let shutdownLogged = false;
  const requestShutdown = (sig: NodeJS.Signals): Promise<void> => {
    requestedExitCode = sig === "SIGINT" ? 130 : 143;
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        if (!shutdownLogged) {
          shutdownLogged = true;
          await deps.appendVerifyLogLine(
            lock.logFile,
            `[verify] stopped signal=${sig} end_s=${Math.floor(Date.now() / 1000)}`,
          );
        }
        if (seedCleanup) {
          await seedCleanup();
          seedCleanup = null;
        }
        const pgids = activePgids.size > 0 ? [...activePgids] : [process.pid];
        await Promise.all(pgids.map(async (pgid) => await deps.killProcessGroup(pgid)));
        await Promise.all(
          [...activeNestedIsos].map(
            async (nestedIso) => await deps.killBuckIsolation(root, nestedIso),
          ),
        );
        await deps.killBuckIsolation(root, iso);
        await cleanupRegisteredTempRepoState();
      })();
    }
    return shutdownPromise;
  };
  deps.installVerifySignalHandlers(requestShutdown);
  const zxNodeModulesOut = shouldComputeLocalZxTestNodeModules(executionPolicy)
    ? await timedPhase(
        "compute-zx-test-node-modules",
        async () => await deps.computeZxTestNodeModulesOut(root, zxInitPath),
      )
    : null;
  const status = await timedPhase(
    "buck-test-passes",
    async () =>
      await deps.runVerifyBuckPasses({
        root,
        iso,
        logFile: lock.logFile,
        console: args.console,
        targets: selection.targets,
        zxNodeModulesOut,
        analysisDir,
        onPgid: (nextPgid) => activePgids.add(nextPgid),
        onPgidDone: (donePgid) => activePgids.delete(donePgid),
        onNestedIso: (nestedIso) => activeNestedIsos.add(nestedIso),
        onNestedIsoDone: (nestedIso) => activeNestedIsos.delete(nestedIso),
        executionPolicy,
      }),
  );
  if (shutdownPromise) await shutdownPromise;
  await cleanupRegisteredTempRepoState();
  await deps.maybeWriteVerifyTimingSummary({ root, logFile: lock.logFile, zxInitPath });
  if (status === 0 && cov.rawDir) await deps.runMergedCoverageReport({ root, rawDir: cov.rawDir });
  if (seedCleanup) {
    await timedPhase("seed-cleanup", async () => await seedCleanup?.());
    seedCleanup = null;
  }
  await timedPhase(
    "kill-verify-buck-isolation",
    async () => await deps.killBuckIsolation(root, iso),
  );
  await deps.runFinalOrphanBuckCleanup({ logFile: lock.logFile, stateFile, timedPhase });
  deps.exit(requestedExitCode ?? status);
}
