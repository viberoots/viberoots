import * as fsp from "node:fs/promises";
import path from "node:path";
import { spawnVerifyBuck2Tests } from "./buck2-test";
import {
  groupVerifyPassesForExecution,
  resourceLimitedStartDelaySeconds,
  verifyPassIsolationDir,
} from "./verify-pass-scheduling";
import { killBuckIsolation } from "./process-control";
import { startVerifySafetyRails, summarizeVerifySafetyRailsTelemetry } from "./safety-rails";
import {
  assertVerifyTargetPlanNotEmpty,
  resolveVerifyTargetPlan,
  summarizeVerifyTargetPlan,
} from "./target-passes";
import type { VerifyExecutionPolicy } from "./remote-policy";

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

  const passIndexes = new Map(passes.map((pass, index) => [pass, index]));
  const startPass = async (pass: (typeof passes)[number], passIso = opts.iso) => {
    const index = passIndexes.get(pass) ?? 0;
    const passAnalysisDir = path.join(opts.analysisDir, `pass-${index + 1}`);
    const startMs = Date.now();
    const startS = Math.floor(startMs / 1000);
    await appendVerifyPassLog(
      opts.logFile,
      `[verify] target pass begin name=${pass.name} index=${index + 1}/${passes.length} iso=${passIso} start_s=${startS} target_count=${pass.targets.length} targets=${pass.targets.join(" ")}`,
    );
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
              `[verify] resource summary pass=${pass.name} samples=${summary.samples} max_load1=${fmt(summary.maxLoad1)} max_load5=${fmt(summary.maxLoad5)} max_processes=${fmt(summary.maxProcessCount)} max_node=${fmt(summary.maxNodeCount)} max_buck=${fmt(summary.maxBuckCount)} max_nix=${fmt(summary.maxNixCount)} max_verify_env=${fmt(summary.maxVerifyEnvCount)}`,
            );
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

  for (const group of groupVerifyPassesForExecution(passes)) {
    const groupStartMs = Date.now();
    const useDedicatedPassIsolation = group.length > 1;
    if (group.length > 1) {
      await appendVerifyPassLog(
        opts.logFile,
        `[verify] target pass group begin mode=concurrent isolation=per-pass passes=${group.map((pass) => pass.name).join(",")}`,
      );
    }
    const resourceLimitedDelayS = resourceLimitedStartDelaySeconds(group);
    const immediatePasses =
      resourceLimitedDelayS > 0 ? group.filter((pass) => pass.name !== "resource-limited") : group;
    const delayedPasses =
      resourceLimitedDelayS > 0 ? group.filter((pass) => pass.name === "resource-limited") : [];
    if (delayedPasses.length > 0) {
      await appendVerifyPassLog(
        opts.logFile,
        `[verify] target pass group staged start delay_s=${resourceLimitedDelayS} immediate=${immediatePasses.map((pass) => pass.name).join(",")} delayed=${delayedPasses.map((pass) => pass.name).join(",")}`,
      );
    }
    let firstFailure = 0;
    const running: Array<{ pgid: number; status: Promise<number> }> = [];
    const trackRun = (run: Awaited<ReturnType<typeof startPass>>) => {
      const status = run.wait().then((value) => {
        if (value !== 0 && firstFailure === 0) {
          firstFailure = value;
          for (const other of running) {
            if (other.pgid !== run.pgid) terminatePassProcessGroup(other.pgid);
          }
        }
        return value;
      });
      running.push({ pgid: run.pgid, status });
    };
    for (const run of await Promise.all(
      immediatePasses.map((pass) =>
        startPass(
          pass,
          verifyPassIsolationDir({
            baseIso: opts.iso,
            passName: pass.name,
            dedicated: useDedicatedPassIsolation,
          }),
        ),
      ),
    )) {
      trackRun(run);
    }
    if (delayedPasses.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, resourceLimitedDelayS * 1000));
      if (firstFailure === 0) {
        for (const run of await Promise.all(
          delayedPasses.map((pass) =>
            startPass(
              pass,
              verifyPassIsolationDir({
                baseIso: opts.iso,
                passName: pass.name,
                dedicated: useDedicatedPassIsolation,
              }),
            ),
          ),
        )) {
          trackRun(run);
        }
      }
    }
    const statuses = await Promise.all(running.map(async (run) => await run.status));
    const status = firstFailure || statuses.find((value) => value !== 0) || 0;
    if (group.length > 1) {
      await appendVerifyPassLog(
        opts.logFile,
        `[verify] target pass group end mode=concurrent isolation=per-pass passes=${group.map((pass) => pass.name).join(",")} status=${status} duration_s=${Math.round((Date.now() - groupStartMs) / 1000)}`,
      );
    }
    if (status !== 0) {
      for (const run of running) terminatePassProcessGroup(run.pgid);
      return status;
    }
  }

  return 0;
}
