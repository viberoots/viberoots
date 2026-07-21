import {
  groupVerifyPassesForExecution,
  isSerialVerifyPass,
  splitVerifyPassGroupForStagedStart,
  verifyPassIsolationDir,
} from "./verify-pass-scheduling";
import { createVerifyProgressReporter, verifyProgressEnabled } from "./progress-line";
import {
  assertVerifyTargetPlanNotEmpty,
  resolveVerifyTargetPlan,
  summarizeVerifyTargetPlan,
} from "./target-passes";
import type { VerifyExecutionPolicy } from "./remote-policy";
import { isVbrVerbose } from "../../lib/command-ui";
import { appendVerifyPassLog, startVerifyPass } from "./verify-pass-runner";

function terminatePassProcessGroup(pgid: number): void {
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {}
  const timer = setTimeout(() => {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  }, 10_000);
  timer.unref?.();
}

export async function runVerifyBuckPasses(opts: {
  root: string;
  iso: string;
  logFile: string | null;
  console: "auto" | "super" | "simple";
  targets: string[];
  zxNodeModulesOut: string | null;
  analysisDir: string;
  onPgid: (pgid: number) => void;
  onPgidDone?: (pgid: number) => void;
  onNestedIso?: (iso: string) => void;
  onNestedIsoDone?: (iso: string) => void;
  executionPolicy: VerifyExecutionPolicy;
  exactOverallTimeoutSecs?: number;
  suppressFailureOutputTail?: () => boolean;
  shouldAbort?: () => boolean;
  artifactToolsRoot: string;
}): Promise<number> {
  const plan = await resolveVerifyTargetPlan({
    root: opts.root,
    iso: opts.iso,
    targets: opts.targets,
    executionPolicy: opts.executionPolicy,
  });
  try {
    assertVerifyTargetPlanNotEmpty({ requestedTargets: opts.targets, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    await appendVerifyPassLog(opts.logFile, `[verify] target resolution failed: ${message}`);
    return 2;
  }
  const passes = plan.passes;
  const expanded = summarizeVerifyTargetPlan(plan);
  await appendVerifyPassLog(
    opts.logFile,
    `[verify] expanded targets: concrete=${expanded.expandedTargetCount} pass_count=${expanded.passCount} isolated_passes=${expanded.isolatedPassCount} isolated_targets=${expanded.isolatedTargetCount} resource_limited_passes=${expanded.resourceLimitedPassCount} resource_limited_targets=${expanded.resourceLimitedTargetCount} shared_targets=${expanded.sharedTargetCount}`,
  );
  if (passes.length !== 1 || passes[0]?.name !== "shared") {
    await appendVerifyPassLog(
      opts.logFile,
      `[verify] target passes: ${passes.map((pass) => `${pass.name}=${pass.targets.join(",")}`).join(" ")}`,
    );
  }

  const showProgress =
    opts.console === "auto" && !isVbrVerbose() && verifyProgressEnabled(process.env);
  const progress = createVerifyProgressReporter({
    enabled: showProgress,
    passes: passes.map((pass) => ({ name: pass.name, total: pass.targets.length })),
  });
  progress.start();
  const shouldAbort = () => opts.shouldAbort?.() === true;
  const waitOrAbort = async (ms: number): Promise<void> => {
    const deadline = Date.now() + ms;
    while (!shouldAbort()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 250)));
    }
  };

  const passIndexes = new Map(passes.map((pass, index) => [pass, index]));
  const startPass = async (pass: (typeof passes)[number], passIso = opts.iso) => {
    const index = passIndexes.get(pass) ?? 0;
    return await startVerifyPass({
      root: opts.root,
      baseIso: opts.iso,
      passIso,
      logFile: opts.logFile,
      console: opts.console,
      pass,
      passIndex: index,
      passCount: passes.length,
      zxNodeModulesOut: opts.zxNodeModulesOut,
      analysisDir: opts.analysisDir,
      executionPolicy: opts.executionPolicy,
      exactOverallTimeoutSecs: opts.exactOverallTimeoutSecs,
      suppressFailureOutputTail: opts.suppressFailureOutputTail,
      shouldAbort,
      artifactToolsRoot: opts.artifactToolsRoot,
      onPgid: opts.onPgid,
      onPgidDone: opts.onPgidDone,
      onNestedIso: opts.onNestedIso,
      onNestedIsoDone: opts.onNestedIsoDone,
      onProgressStart: (name) => progress.update(name, { status: "running" }),
      onProgressUpdate: (name, state) => progress.update(name, state),
      onProgressStop: (name, status) =>
        progress.update(name, { status: status === 0 ? "done" : "failed" }),
    });
  };

  let aggregateStatus = 0;
  for (const group of groupVerifyPassesForExecution(passes)) {
    if (shouldAbort()) {
      await appendVerifyPassLog(opts.logFile, "[verify] target pass scheduling aborted");
      break;
    }
    const groupStartMs = Date.now();
    const useDedicatedPassIsolation = group.length > 1;
    const dedicatedIsolationFor = (passName: string) =>
      useDedicatedPassIsolation || passes.length > 1 || isSerialVerifyPass(passName);
    if (group.length > 1) {
      await appendVerifyPassLog(
        opts.logFile,
        `[verify] target pass group begin mode=concurrent isolation=per-pass passes=${group.map((pass) => pass.name).join(",")}`,
      );
    }
    const { delaySeconds, immediatePasses, delayedPasses, waitForImmediatePassesBeforeDelayed } =
      splitVerifyPassGroupForStagedStart(group);
    if (delayedPasses.length > 0) {
      await appendVerifyPassLog(
        opts.logFile,
        `[verify] target pass group staged start delay_s=${delaySeconds} wait_for_immediate=${waitForImmediatePassesBeforeDelayed ? "true" : "false"} immediate=${immediatePasses.map((pass) => pass.name).join(",")} delayed=${delayedPasses.map((pass) => pass.name).join(",")}`,
      );
    }
    let firstFailure = 0;
    const running: Array<{ pgid: number; status: Promise<number> }> = [];
    const trackRun = (run: Awaited<ReturnType<typeof startPass>>) => {
      const status = run.wait().then((value) => {
        if (value !== 0 && firstFailure === 0) {
          firstFailure = value;
        }
        return value;
      });
      running.push({ pgid: run.pgid, status });
    };
    if (!shouldAbort()) {
      for (const run of await Promise.all(
        immediatePasses.map((pass) =>
          startPass(
            pass,
            verifyPassIsolationDir({
              baseIso: opts.iso,
              passName: pass.name,
              dedicated: dedicatedIsolationFor(pass.name),
            }),
          ),
        ),
      )) {
        if (run) trackRun(run);
      }
    }
    const waitForRunning = async () =>
      await Promise.all(running.map(async (run) => await run.status));
    if (delayedPasses.length > 0 && waitForImmediatePassesBeforeDelayed && !shouldAbort()) {
      await waitForRunning();
    } else if (delayedPasses.length > 0 && !shouldAbort()) {
      await waitOrAbort(delaySeconds * 1000);
    }
    if (delayedPasses.length > 0 && !shouldAbort()) {
      for (const run of await Promise.all(
        delayedPasses.map((pass) =>
          startPass(
            pass,
            verifyPassIsolationDir({
              baseIso: opts.iso,
              passName: pass.name,
              dedicated: dedicatedIsolationFor(pass.name),
            }),
          ),
        ),
      )) {
        if (run) trackRun(run);
      }
    }
    const statuses = await waitForRunning();
    const status = firstFailure || statuses.find((value) => value !== 0) || 0;
    if (status !== 0 && aggregateStatus === 0) aggregateStatus = status;
    if (group.length > 1) {
      await appendVerifyPassLog(
        opts.logFile,
        `[verify] target pass group end mode=concurrent isolation=per-pass passes=${group.map((pass) => pass.name).join(",")} status=${status} duration_s=${Math.round((Date.now() - groupStartMs) / 1000)}`,
      );
    }
    if (status !== 0) {
      for (const run of running) terminatePassProcessGroup(run.pgid);
    }
    if (shouldAbort()) {
      await appendVerifyPassLog(opts.logFile, "[verify] target pass scheduling aborted");
      break;
    }
  }

  progress.stop({ clear: false });
  return shouldAbort() && aggregateStatus === 0 ? 130 : aggregateStatus;
}
