import * as fsp from "node:fs/promises";
import path from "node:path";
import { prepareVerifyBuckIsolationMetadata } from "./buck-isolation-metadata";
import { spawnVerifyBuck2Tests } from "./buck2-test";
import { previewVerifyNestedBuckIsolation } from "./buck2-test-env";
import { killBuckIsolation } from "./process-control";
import { executionPolicyForVerifyPass, type VerifyExecutionPolicy } from "./remote-policy";
import { startVerifySafetyRails, summarizeVerifySafetyRailsTelemetry } from "./safety-rails";
import type { VerifyTargetPass } from "./target-passes";

export async function appendVerifyPassLog(file: string | null, line: string): Promise<void> {
  if (!file) return;
  await fsp.appendFile(file, `${line}\n`, "utf8").catch(() => {});
}

export async function startVerifyPass(opts: {
  root: string;
  baseIso: string;
  passIso: string;
  logFile: string | null;
  console: "auto" | "super" | "simple";
  pass: VerifyTargetPass;
  passIndex: number;
  passCount: number;
  zxNodeModulesOut: string | null;
  analysisDir: string;
  executionPolicy: VerifyExecutionPolicy;
  exactOverallTimeoutSecs?: number;
  suppressFailureOutputTail?: () => boolean;
  shouldAbort: () => boolean;
  onPgid: (pgid: number) => void;
  onPgidDone?: (pgid: number) => void;
  onNestedIso?: (iso: string) => void;
  onNestedIsoDone?: (iso: string) => void;
  onProgressStart: (name: string) => void;
  onProgressUpdate: (name: string, state: { completed: number; failed: number }) => void;
  onProgressStop: (name: string, status: number) => void;
}): Promise<{ pgid: number; wait: () => Promise<number> } | null> {
  if (opts.shouldAbort()) return null;
  const passAnalysisDir = path.join(opts.analysisDir, `pass-${opts.passIndex + 1}`);
  const startMs = Date.now();
  const startS = Math.floor(startMs / 1000);
  await appendVerifyPassLog(
    opts.logFile,
    `[verify] target pass begin name=${opts.pass.name} index=${opts.passIndex + 1}/${opts.passCount} iso=${opts.passIso} start_s=${startS} target_count=${opts.pass.targets.length} targets=${opts.pass.targets.join(" ")}`,
  );
  await prepareVerifyBuckIsolationMetadata({
    root: opts.root,
    passIso: opts.passIso,
    nestedIso: previewVerifyNestedBuckIsolation(opts.passIso, opts.pass.name),
  });
  if (opts.shouldAbort()) return null;
  const spawned = spawnVerifyBuck2Tests({
    root: opts.root,
    iso: opts.passIso,
    logFile: opts.logFile,
    console: opts.console,
    targets: opts.pass.targets,
    zxNodeModulesOut: opts.zxNodeModulesOut,
    threadsOverride: opts.pass.threadsOverride,
    passName: opts.pass.name,
    analysisDir: passAnalysisDir,
    executionPolicy: executionPolicyForVerifyPass(opts.executionPolicy, opts.pass.name),
    exactOverallTimeoutSecs: opts.exactOverallTimeoutSecs,
    suppressFailureOutputTail: opts.suppressFailureOutputTail,
    onProgressStart: opts.onProgressStart,
    onProgressUpdate: opts.onProgressUpdate,
    onProgressStop: opts.onProgressStop,
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
        if (opts.passIso !== opts.baseIso) {
          await killBuckIsolation(opts.root, opts.passIso).catch(() => {});
        }
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
            `[verify] resource summary pass=${opts.pass.name} samples=${summary.samples} max_load1=${fmt(summary.maxLoad1)} max_load5=${fmt(summary.maxLoad5)} max_processes=${fmt(summary.maxProcessCount)} max_node=${fmt(summary.maxNodeCount)} max_buck=${fmt(summary.maxBuckCount)} max_nix=${fmt(summary.maxNixCount)} max_verify_env=${fmt(summary.maxVerifyEnvCount)} high_load_top_process_samples=${summary.highLoadTopProcessSamples}`,
          );
          for (const line of summary.highLoadTopProcessLines) {
            await appendVerifyPassLog(
              opts.logFile,
              `[verify] high-load top-process summary pass=${opts.pass.name} ${line}`,
            );
          }
        }
      }
      await appendVerifyPassLog(
        opts.logFile,
        `[verify] target pass end name=${opts.pass.name} index=${opts.passIndex + 1}/${opts.passCount} status=${status} duration_s=${Math.round((Date.now() - startMs) / 1000)}`,
      );
      return status;
    },
  };
}
