import * as fsp from "node:fs/promises";
import path from "node:path";
import { prepareVerifyBuckIsolationMetadata } from "./buck-isolation-metadata";
import { spawnVerifyBuck2Tests } from "./buck2-test";
import { previewVerifyNestedBuckIsolation } from "./buck2-test-env";
import {
  groupVerifyPassesForExecution,
  isSerialVerifyPass,
  splitVerifyPassGroupForStagedStart,
  verifyPassIsolationDir,
} from "./verify-pass-scheduling";
import { killBuckIsolation } from "./process-control";
import { createVerifyProgressReporter, verifyProgressEnabled } from "./progress-line";
import { startVerifySafetyRails, summarizeVerifySafetyRailsTelemetry } from "./safety-rails";
import {
  assertVerifyTargetPlanNotEmpty,
  resolveVerifyTargetPlan,
  summarizeVerifyTargetPlan,
} from "./target-passes";
import type { VerifyExecutionPolicy } from "./remote-policy";
import { isVbrVerbose } from "../../lib/command-ui";

async function appendVerifyPassLog(file: string | null, line: string): Promise<void> {
  if (!file) return;
  await fsp.appendFile(file, `${line}\n`, "utf8").catch(() => {});
}

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
}): Promise<number> {
  const plan = resolveVerifyTargetPlan({
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
    if (shouldAbort()) return null;
    const index = passIndexes.get(pass) ?? 0;
    const passAnalysisDir = path.join(opts.analysisDir, `pass-${index + 1}`);
    const startMs = Date.now();
    const startS = Math.floor(startMs / 1000);
    await appendVerifyPassLog(
      opts.logFile,
      `[verify] target pass begin name=${pass.name} index=${index + 1}/${passes.length} iso=${passIso} start_s=${startS} target_count=${pass.targets.length} targets=${pass.targets.join(" ")}`,
    );
    await prepareVerifyBuckIsolationMetadata({
      root: opts.root,
      passIso,
      nestedIso: previewVerifyNestedBuckIsolation(passIso, pass.name),
    });
    if (shouldAbort()) return null;
    const spawned = spawnVerifyBuck2Tests({
      root: opts.root,
      iso: passIso,
      logFile: opts.logFile,
      console: opts.console,
      targets: pass.targets,
      zxNodeModulesOut: opts.zxNodeModulesOut,
      threadsOverride: pass.threadsOverride,
      passName: pass.name,
      analysisDir: passAnalysisDir,
      executionPolicy: opts.executionPolicy,
      exactOverallTimeoutSecs: opts.exactOverallTimeoutSecs,
      suppressFailureOutputTail: opts.suppressFailureOutputTail,
      onProgressStart: (name) => progress.update(name, { status: "running" }),
      onProgressUpdate: (name, state) => progress.update(name, state),
      onProgressStop: (name, status) =>
        progress.update(name, { status: status === 0 ? "done" : "failed" }),
    });
    opts.onPgid(spawned.pgid);
    opts.onNestedIso?.(spawned.nestedIso);
    const rails = await startVerifySafetyRails({
      root: opts.root,
      analysisDir: passAnalysisDir,
      processGroupIdToKill: spawned.pgid,
      onTrigger: async (reason) =>
        appendVerifyPassLog(
          opts.logFile,
          reason.startsWith("[notice] ")
            ? `[verify] safety-rails notice: ${reason.slice(9)}`
            : `[verify] safety-rails stop: ${reason}`,
        ),
    });
    return {
      pgid: spawned.pgid,
      wait: async () => {
        let status = 1;
        try {
          status = await spawned.wait();
        } finally {
          rails.stop();
          opts.onPgidDone?.(spawned.pgid);
          await killBuckIsolation(opts.root, spawned.nestedIso).catch(() => {});
          opts.onNestedIsoDone?.(spawned.nestedIso);
          if (passIso !== opts.iso) await killBuckIsolation(opts.root, passIso).catch(() => {});
        }
        if (rails.telemetryPath) {
          const summary = await summarizeVerifySafetyRailsTelemetry(rails.telemetryPath).catch(
            () => null,
          );
          if (summary && summary.samples > 0) {
            const fmt = (value: number | null) =>
              value == null ? "?" : Number.isInteger(value) ? String(value) : value.toFixed(2);
            await appendVerifyPassLog(
              opts.logFile,
              `[verify] resource summary pass=${pass.name} samples=${summary.samples} max_load1=${fmt(summary.maxLoad1)} max_load5=${fmt(summary.maxLoad5)} max_processes=${fmt(summary.maxProcessCount)} max_node=${fmt(summary.maxNodeCount)} max_buck=${fmt(summary.maxBuckCount)} max_nix=${fmt(summary.maxNixCount)} max_verify_env=${fmt(summary.maxVerifyEnvCount)} high_load_top_process_samples=${summary.highLoadTopProcessSamples}`,
            );
            for (const line of summary.highLoadTopProcessLines) {
              await appendVerifyPassLog(
                opts.logFile,
                `[verify] high-load top-process summary pass=${pass.name} ${line}`,
              );
            }
          }
        }
        await appendVerifyPassLog(
          opts.logFile,
          `[verify] target pass end name=${pass.name} index=${index + 1}/${passes.length} status=${status} duration_s=${Math.round((Date.now() - startMs) / 1000)}`,
        );
        return status;
      },
    };
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
    const { delaySeconds, immediatePasses, delayedPasses } =
      splitVerifyPassGroupForStagedStart(group);
    if (delayedPasses.length > 0) {
      await appendVerifyPassLog(
        opts.logFile,
        `[verify] target pass group staged start delay_s=${delaySeconds} immediate=${immediatePasses.map((pass) => pass.name).join(",")} delayed=${delayedPasses.map((pass) => pass.name).join(",")}`,
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
    if (delayedPasses.length > 0 && !shouldAbort()) {
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
    const statuses = await Promise.all(running.map(async (run) => await run.status));
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
