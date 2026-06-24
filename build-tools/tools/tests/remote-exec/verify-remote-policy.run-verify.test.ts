#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runVerifyWithDeps, SCOPED_VERIFY_RSYNC_ROOTS } from "../../dev/verify/run-verify";
import { defaultRunVerifyDeps, type RunVerifyDeps } from "../../dev/verify/run-verify-deps";
import { shouldPrepareVerifySeedForRequestedTargets } from "../../dev/verify/seed";

const remoteEnv = {
  VBR_REMOTE_ARTIFACT_DIR: "/tmp/vbr-remote/artifacts",
  VBR_REMOTE_BUCK_CONFIG: "/tmp/vbr-remote/buckconfig",
  VBR_REMOTE_EXEC_MODE: "hybrid",
  VBR_REMOTE_EXEC_SYSTEM: "x86_64-linux",
  VBR_REMOTE_TEST_ACTIVATION_DIR: "/tmp/vbr-remote/activation",
};

class VerifyExit extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`verify exited ${code}`);
    this.code = code;
  }
}

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in prev)) delete process.env[key];
    }
    Object.assign(process.env, prev);
  }
}

function fakeRunVerifyDeps(calls: string[]): Partial<RunVerifyDeps> {
  const timedPhase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    calls.push(`phase:${name}`);
    return await fn();
  };
  return {
    ...defaultRunVerifyDeps,
    acquireVerifyLock: async () => ({ lockDir: "/tmp/verify-lock", logFile: null }),
    appendVerifyLogLine: async () => {},
    chdir: () => {},
    cleanupLocalOrphanBuckDaemons: async () => calls.push("local-orphan-cleanup"),
    cleanupVerifyLegacyPnpmState: async () => calls.push("local-pnpm-cleanup"),
    computeZxTestNodeModulesOut: async () => {
      calls.push("compute-zx");
      return "/nix/store/local-zx-node-modules";
    },
    createRegisteredStateCleaner: () => async () => calls.push("cleanup-state"),
    createVerifyPhaseTimer: () => ({ setLogFile: async () => {}, timedPhase }),
    ensureBuckPreludeConfig: async () => {},
    ensureRepoLocalTmpRoot: async () => {},
    ensureVerifyPinnedNixpkgs: async () => calls.push("ensure-pinned"),
    applyNixCacheHealthPolicy: async () => calls.push("nix-cache-health"),
    exit: ((code: number) => {
      throw new VerifyExit(code);
    }) as RunVerifyDeps["exit"],
    initializeVerifyProcessState: async () => {
      calls.push("initialize-state");
      return { iso: "v-1-test", stateFile: "/tmp/state" };
    },
    installVerifySignalHandlers: () => {},
    isNonBuildSystemOnlyVerifyTargets: () => false,
    killBuckIsolation: async () => {},
    logVerifyRevision: async () => {},
    maybeWriteVerifyTimingSummary: async () => {},
    parseVerifyArgs: () => ({
      coverage: false,
      console: "simple",
      explainSelection: false,
      requestedProjects: [],
      selector: "default",
      targets: ["//:remote_exec_verify_remote_policy"],
    }),
    prepareVerifySeed: async (opts) => {
      calls.push(`prepare-seed:${opts.mode || "local"}`);
      return {
        cleanup: async () => {},
        pinDir: "/tmp/pin",
        remoteManifestPath: "/tmp/seed-manifest.json",
        seedKey: "seed",
        seedPath: "/tmp/seed",
      };
    },
    prewarmVerifyOnce: async () => calls.push("prewarm"),
    recordNixGcPreflight: async () => {},
    repoRoot: () => "/tmp/repo",
    runStartupCheck: async () => calls.push("startup"),
    setupLocalVerifyWorkspace: async () => {
      calls.push("setup-local-workspace");
      return { rawDir: "/tmp/coverage/raw" };
    },
    shouldPrepareVerifySeedForRequestedTargets: () => {
      calls.push("should-seed");
      return true;
    },
    startBuckDaemonReaper: async () => calls.push("daemon-reaper"),
    startBuckWatchdog: async () => calls.push("watchdog"),
    ...fakeRunVerifyNoops(calls),
  };
}

function fakeRunVerifyNoops(calls: string[]): Partial<RunVerifyDeps> {
  return {
    recordNixGcPreflight: async () => {},
    resolveRequestedVerifyScope: async ({ args }) => {
      calls.push("resolve-scope");
      return {
        args,
        selection: {
          diagnostics: null,
          lintFilters: [],
          reason: "explicit-targets",
          requestedDeploymentMode: "auto",
          requestedMode: "auto",
          selectorMode: "explicit",
          targets: args.targets,
        },
      };
    },
    runExplainSelection: async () => {},
    runFinalOrphanBuckCleanup: async () => {},
    runMergedCoverageReport: async () => {},
    runTemplateManifestCheck: async () => {},
    runVerifyBuckPasses: async (opts) => {
      calls.push(`buck-passes-zx:${opts.zxNodeModulesOut ?? "<null>"}`);
      return 0;
    },
    runVerifyLintPreflight: async () => {},
    summarizeVerifyScopeDecision: () => "explicit-targets",
    writeVerifyIsoMarker: async () => {},
  };
}

test("runVerify rejects remote policy before local setup side effects", async () => {
  const calls: string[] = [];
  await assert.rejects(
    async () =>
      await withEnv(
        { ...remoteEnv, VBR_REMOTE_BUCK_CONFIG: "relative/.buckconfig" },
        async () => await runVerifyWithDeps(fakeRunVerifyDeps(calls)),
      ),
    /VBR_REMOTE_BUCK_CONFIG must be an absolute path/,
  );

  assert.deepEqual(
    calls.filter(
      (call) =>
        call.startsWith("phase:") ||
        call.includes("local") ||
        call === "compute-zx" ||
        call === "initialize-state" ||
        call === "resolve-scope",
    ),
    [],
  );
});

test("runVerify rejects remote coverage before coverage setup paths are created", async () => {
  const calls: string[] = [];
  await assert.rejects(
    async () =>
      await withEnv(remoteEnv, async () => {
        const deps = fakeRunVerifyDeps(calls);
        deps.parseVerifyArgs = () => ({
          coverage: true,
          console: "simple",
          explainSelection: false,
          requestedProjects: [],
          selector: "default",
          targets: ["//:remote_exec_verify_remote_policy"],
        });
        await runVerifyWithDeps(deps);
      }),
    /declared raw coverage outputs and local aggregation materialization/,
  );

  assert.equal(calls.includes("setup-local-workspace"), false);
  assert.equal(calls.includes("initialize-state"), false);
  assert.equal(calls.includes("resolve-scope"), false);
  assert.equal(
    calls.some((call) => call.includes("coverage")),
    false,
  );
});

test("runVerify accepted remote mode prepares remote-ready seed and skips local zx node_modules", async () => {
  const calls: string[] = [];
  await assert.rejects(
    async () =>
      await withEnv(remoteEnv, async () => await runVerifyWithDeps(fakeRunVerifyDeps(calls))),
    (error) => error instanceof VerifyExit && error.code === 0,
  );

  assert.equal(calls.includes("compute-zx"), false);
  assert.equal(calls.includes("setup-local-workspace"), false);
  assert.ok(calls.includes("should-seed"));
  assert.ok(calls.includes("prepare-seed:remote-ready"));
  assert.ok(calls.includes("buck-passes-zx:<null>"));
});

test("local scoped verify without seed gives runInTemp an explicit rsync repo setup", async () => {
  const calls: string[] = [];
  await assert.rejects(
    async () =>
      await withEnv({ TEST_RSYNC_ROOTS: "" }, async () => {
        const deps = fakeRunVerifyDeps(calls);
        deps.shouldPrepareVerifySeedForRequestedTargets = () => {
          calls.push("should-seed");
          return false;
        };
        deps.runVerifyBuckPasses = async () => {
          calls.push(`rsync-roots:${process.env.TEST_RSYNC_ROOTS || ""}`);
          return 0;
        };
        await runVerifyWithDeps(deps);
      }),
    (error) => error instanceof VerifyExit && error.code === 0,
  );

  assert.ok(calls.includes("should-seed"));
  assert.equal(calls.includes("prepare-seed:local"), false);
  assert.ok(calls.includes(`rsync-roots:${SCOPED_VERIFY_RSYNC_ROOTS}`));
});

test("local broad scoped verify prepares seed instead of falling back to rsync roots", async () => {
  const calls: string[] = [];
  await assert.rejects(
    async () =>
      await withEnv({ TEST_RSYNC_ROOTS: "" }, async () => {
        const deps = fakeRunVerifyDeps(calls);
        deps.parseVerifyArgs = () => ({
          coverage: false,
          console: "simple",
          explainSelection: false,
          requestedProjects: [],
          selector: "default",
          targets: ["//projects/...", "//viberoots/..."],
        });
        deps.shouldPrepareVerifySeedForRequestedTargets =
          shouldPrepareVerifySeedForRequestedTargets;
        deps.runVerifyBuckPasses = async () => {
          calls.push(`seed-path:${process.env.VBR_TEST_SEED_STORE_PATH || ""}`);
          calls.push(`rsync-roots:${process.env.TEST_RSYNC_ROOTS || ""}`);
          return 0;
        };
        await runVerifyWithDeps(deps);
      }),
    (error) => error instanceof VerifyExit && error.code === 0,
  );

  assert.ok(calls.includes("prepare-seed:local"));
  assert.ok(calls.includes("seed-path:/tmp/seed"));
  assert.ok(calls.includes("rsync-roots:"));
});

test("runVerify rejects remote mode without activation before Buck", async () => {
  const calls: string[] = [];
  const { VBR_REMOTE_TEST_ACTIVATION_DIR: _unused, ...env } = remoteEnv;
  await assert.rejects(
    async () => await withEnv(env, async () => await runVerifyWithDeps(fakeRunVerifyDeps(calls))),
    /VBR_REMOTE_TEST_ACTIVATION_DIR is required/,
  );

  assert.equal(calls.includes("setup-local-workspace"), false);
  assert.equal(calls.includes("initialize-state"), false);
  assert.equal(calls.includes("resolve-scope"), false);
  assert.equal(calls.includes("buck-passes-zx:<null>"), false);
});
