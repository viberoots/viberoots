import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runNodeWithZx } from "../../lib/node-run.ts";
import { ensureBuckPreludeConfig } from "../dev-build/prelude.ts";
import { runStartupCheck } from "../dev-build/startup.ts";
import { repoRoot } from "../dev-build/paths.ts";
import { parseVerifyArgs } from "./args.ts";
import { setupCoverage, runMergedCoverageReport } from "./coverage.ts";
import { acquireVerifyLock } from "./lock.ts";
import {
  enforceVerifyDiskGate,
  runVerifyHousekeeping,
  verifyTargetFreeGiBDefault,
} from "./housekeeping.ts";
import { startVerifySafetyRails } from "./safety-rails.ts";
import { spawnVerifyBuck2Tests } from "./buck2-test.ts";
import { runVerifyLintPreflight } from "./lint-preflight.ts";
import { cleanupOrphanBuckDaemons } from "./buck-orphan-cleanup.ts";
import {
  appendVerifyLogLine,
  killBuckIsolation,
  killProcessGroup,
  startBuckDaemonReaper,
  startBuckWatchdog,
  writeVerifyIsoMarker,
} from "./process-control.ts";
import { prewarmVerifyOnce } from "./prewarm.ts";
import { ensureRepoLocalTmpRoot } from "./tmp-root.ts";
import { computeZxTestNodeModulesOut } from "./zx-node-modules.ts";

export async function runVerify(): Promise<void> {
  const root = repoRoot();
  const args = parseVerifyArgs();
  const zxInitPath = path.join(root, "tools", "dev", "zx-init.mjs");

  await runStartupCheck(root);
  process.chdir(root);

  // Run lint preflight before acquiring the verify lock so formatting-only failures
  // don't create a verify-lock dir.
  await runVerifyLintPreflight(root);

  const allowConcurrent = process.env.VERIFY_ALLOW_CONCURRENT === "1";
  const lock = await acquireVerifyLock({ root, allowConcurrent });
  await ensureRepoLocalTmpRoot(root);

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

  const targetFreeGiB = verifyTargetFreeGiBDefault(args.coverage);
  const { freeGiB } = await runVerifyHousekeeping({ root, targetFreeGiB, zxInitPath });
  enforceVerifyDiskGate({ freeGiB, targetFreeGiB });

  const cov = await setupCoverage({ root, enabled: args.coverage });

  const iso = `v-${process.pid}-${Date.now()}`;
  await writeVerifyIsoMarker(lock.lockDir, iso);
  await appendVerifyLogLine(lock.logFile, `[verify] begin iso=${iso}`);
  // Log the current git revision for performance correlation across runs.
  // This intentionally runs after we have a logFile (verify-lock acquired).
  try {
    const revOut = await $({ cwd: root, stdio: "pipe", reject: false })`git rev-parse HEAD`;
    const rev = String((revOut as any).stdout || "").trim();
    const dirtyOut = await $({
      cwd: root,
      stdio: "pipe",
      reject: false,
    })`bash --noprofile --norc -c 'test -z \"$(git status --porcelain 2>/dev/null)\" && echo 0 || echo 1'`;
    const dirty = String((dirtyOut as any).stdout || "").trim() || "0";
    if (rev) await appendVerifyLogLine(lock.logFile, `[verify] rev=${rev} dirty=${dirty}`);
  } catch {}

  // One buck-daemon-reaper per verify run. zx tests register temp repo roots via BNX_BUCK_REAPER_STATE_FILE.
  const stateFile = path.join(process.env.TMPDIR || "/tmp", `bucknix-buck-reaper-${iso}.txt`);
  process.env.BNX_BUCK_REAPER_STATE_FILE = stateFile;
  await fsp.writeFile(stateFile, "", "utf8").catch(() => {});
  await startBuckDaemonReaper({ root, zxInitPath, iso, stateFile });
  await startBuckWatchdog({ root, zxInitPath, iso });
  await prewarmVerifyOnce(root, zxInitPath);

  // Proactively kill *orphaned* buck2 daemons rooted under temp repos to avoid host overload.
  // This is intentionally scoped to temp-repo roots (e.g. /tmp/bnx-* or buck-out/tmp/tmpdir/*).
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
  const signalHandler = (sig: NodeJS.Signals) => {
    void (async () => {
      await killProcessGroup(pgid);
      await killBuckIsolation(root, iso);
      process.exit(sig === "SIGINT" ? 130 : 143);
    })();
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    try {
      process.on(sig, () => signalHandler(sig));
    } catch {}
  }

  const zxNodeModulesOut = await computeZxTestNodeModulesOut(root, zxInitPath);
  const spawned = spawnVerifyBuck2Tests({
    root,
    iso,
    logFile: lock.logFile,
    console: args.console,
    targets: args.targets,
    zxNodeModulesOut,
  });
  pgid = spawned.pgid;
  const rails = await startVerifySafetyRails({
    root,
    analysisDir,
    processGroupIdToKill: pgid,
  });
  const status = await spawned.wait();
  rails.stop();

  if (process.env.TEST_TIMING === "summary" && lock.logFile) {
    await runNodeWithZx({
      cwd: root,
      script: path.join(root, "tools/dev/analyze-verify-timing.ts"),
      args: ["--log", lock.logFile, "--comment"],
      zxInitPath,
      stdio: "pipe",
    }).catch(() => {});
  }

  if (status === 0 && cov.rawDir) {
    await runMergedCoverageReport({ root, rawDir: cov.rawDir });
  }

  await killBuckIsolation(root, iso);
  process.exit(status);
}
