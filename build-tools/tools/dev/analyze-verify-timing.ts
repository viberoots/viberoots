#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getFlagBool, getFlagStr, getPositionals } from "../lib/cli.ts";
import { stripAnsiAndCrs } from "../lib/verify-log-status/types.ts";
import {
  findLastFullSuiteWindowStart,
  parseVerifyBeginEpochSec,
  parseBuck2ExitMarker,
} from "../lib/verify-log-status/parsing.ts";
import {
  collectVerifyTimingStats,
  type TargetTimingBreakdown,
  type TimingBucket,
} from "./analyze-verify-timing-helpers.ts";
import {
  collectPhaseTimings,
  collectResourceSummaries,
  type VerifyPhaseTiming,
  type VerifyResourceSummary,
} from "./analyze-verify-log-extras.ts";

export type VerifyTimingAnalysis = {
  logPath: string;
  wallSec?: number;
  beginEpochSec?: number;
  endEpochSec?: number;
  phases: VerifyPhaseTiming[];
  testsWithDurations: number;
  sumTestDurationsSec: number;
  effectiveParallelism?: number;
  resourceSummaries: VerifyResourceSummary[];
  buckets: TimingBucket[];
  targetTimings: TargetTimingBreakdown[];
};

export function analyzeVerifyTimingFromLogText(opts: {
  logPath: string;
  text: string;
}): VerifyTimingAnalysis {
  const cleaned = stripAnsiAndCrs(opts.text);
  const lines = cleaned.split("\n");
  const startIdx = findLastFullSuiteWindowStart(lines);
  const window = startIdx > 0 ? lines.slice(startIdx) : lines;

  const begin = parseVerifyBeginEpochSec(window);
  const exit = parseBuck2ExitMarker(window);
  const end = exit.endSec;
  const wallSec = begin !== undefined && end !== undefined && end > begin ? end - begin : undefined;
  const durationStats = collectVerifyTimingStats(window);
  const effectiveParallelism =
    wallSec !== undefined && wallSec > 0 && durationStats.sumTestDurationsSec > 0
      ? durationStats.sumTestDurationsSec / wallSec
      : undefined;
  const stats = collectVerifyTimingStats(window, effectiveParallelism);

  return {
    logPath: path.normalize(opts.logPath),
    wallSec,
    beginEpochSec: begin,
    endEpochSec: end,
    phases: collectPhaseTimings(window),
    testsWithDurations: durationStats.testsWithDurations,
    sumTestDurationsSec: durationStats.sumTestDurationsSec,
    effectiveParallelism,
    resourceSummaries: collectResourceSummaries(window),
    buckets: stats.buckets,
    targetTimings: stats.targetTimings,
  };
}

export function formatVerifyTimingAnalysisText(
  a: VerifyTimingAnalysis,
  opts?: {
    maxBuckets?: number;
    comment?: boolean;
    slowTargetSec?: number;
    maxTargets?: number;
    maxTargetBuckets?: number;
  },
): string {
  const maxBuckets = opts?.maxBuckets ?? 15;
  const slowTargetSec = opts?.slowTargetSec ?? 30;
  const maxTargets = opts?.maxTargets ?? 5;
  const maxTargetBuckets = opts?.maxTargetBuckets ?? 5;
  const prefix = opts?.comment ? "# " : "";
  const fmtNum = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "?");
  const fmtSec = (n?: number) => (n === undefined ? "?" : fmtNum(n));

  const lines: string[] = [];
  lines.push(`${prefix}[timing] aggregate: log=${a.logPath}`);
  if (a.wallSec !== undefined) {
    lines.push(
      `${prefix}[timing] aggregate: wall=${fmtSec(a.wallSec)}s start_s=${a.beginEpochSec} end_s=${a.endEpochSec}`,
    );
  } else {
    lines.push(
      `${prefix}[timing] aggregate: wall=? start_s=${a.beginEpochSec} end_s=${a.endEpochSec}`,
    );
  }
  lines.push(`${prefix}[timing] aggregate: tests_with_durations=${a.testsWithDurations}`);
  lines.push(`${prefix}[timing] aggregate: sum_test_durations=${fmtSec(a.sumTestDurationsSec)}s`);
  lines.push(
    `${prefix}[timing] aggregate: effective_parallelism=${
      a.effectiveParallelism === undefined ? "?" : fmtNum(a.effectiveParallelism)
    }`,
  );
  for (const r of a.resourceSummaries) {
    lines.push(
      `${prefix}[timing] resource pass=${r.pass} samples=${r.samples} max_load1=${r.maxLoad1 === undefined ? "?" : fmtNum(r.maxLoad1)} max_processes=${r.maxProcesses ?? "?"} max_node=${r.maxNode ?? "?"} max_buck=${r.maxBuck ?? "?"} max_nix=${r.maxNix ?? "?"} max_verify_env=${r.maxVerifyEnv ?? "?"}`,
    );
  }
  if (a.phases.length > 0) {
    lines.push(`${prefix}[timing] verify_phases_sorted_by_duration:`);
    for (const phase of [...a.phases].sort((a, b) => b.durationMs - a.durationMs).slice(0, 15)) {
      lines.push(`${prefix}[timing] phase ${(phase.durationMs / 1000).toFixed(2)}s: ${phase.name}`);
    }
  }

  if (a.buckets.length === 0) {
    lines.push(`${prefix}[timing] aggregate: buckets=0 (no [timing] summary lines found)`);
    return lines.join("\n");
  }

  lines.push(`${prefix}[timing] aggregate: top_buckets_sorted_by_total_ms:`);
  for (const b of a.buckets.slice(0, Math.max(0, maxBuckets))) {
    const totalSec = b.msTotal / 1000;
    const est = b.estWallSec === undefined ? "?" : fmtSec(b.estWallSec);
    lines.push(
      `${prefix}[timing] ${fmtNum(totalSec)}s total (${b.count}x, avg ${fmtNum(b.avgMs)}ms) est_wall=${est}s: ${b.label}`,
    );
  }
  if (a.buckets.length > maxBuckets) {
    lines.push(`${prefix}[timing] ... ${a.buckets.length - maxBuckets} more`);
  }

  const slowTargets = a.targetTimings.filter((target) => target.durationSec >= slowTargetSec);
  if (slowTargets.length === 0) {
    lines.push(`${prefix}[timing] slow_targets_with_timing=0 threshold=${fmtNum(slowTargetSec)}s`);
    return lines.join("\n");
  }

  lines.push(
    `${prefix}[timing] slow_targets_with_timing=${slowTargets.length} threshold=${fmtNum(slowTargetSec)}s`,
  );
  for (const target of slowTargets.slice(0, Math.max(0, maxTargets))) {
    lines.push(
      `${prefix}[timing] slow-target ${fmtSec(target.durationSec)}s ${target.status} ${target.target} (${target.rawDuration})`,
    );
    for (const bucket of target.buckets.slice(0, Math.max(0, maxTargetBuckets))) {
      lines.push(
        `${prefix}[timing] target-bucket ${(bucket.msTotal / 1000).toFixed(2)}s total (${bucket.count}x, avg ${fmtNum(bucket.avgMs)}ms): ${bucket.label}`,
      );
    }
    if (target.buckets.length > maxTargetBuckets) {
      lines.push(
        `${prefix}[timing] target-bucket ... ${target.buckets.length - maxTargetBuckets} more for ${target.target}`,
      );
    }
  }
  if (slowTargets.length > maxTargets) {
    lines.push(`${prefix}[timing] slow-target ... ${slowTargets.length - maxTargets} more`);
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const pos = getPositionals();
  const log = getFlagStr("log", "").trim() || (pos[0] ? String(pos[0]) : "").trim();
  if (!log) {
    console.error(
      "usage: node build-tools/tools/dev/analyze-verify-timing.ts --log <path/to/verify.log>",
    );
    console.error("  or: node build-tools/tools/dev/analyze-verify-timing.ts <path/to/verify.log>");
    return 2;
  }
  const comment = getFlagBool("comment");
  const maxBucketsRaw = getFlagStr("max-buckets", "").trim();
  const maxBuckets = maxBucketsRaw ? Number(maxBucketsRaw) : undefined;
  const slowTargetSecRaw = getFlagStr("slow-target-sec", "").trim();
  const maxTargetsRaw = getFlagStr("max-targets", "").trim();
  const maxTargetBucketsRaw = getFlagStr("max-target-buckets", "").trim();
  const slowTargetSec = slowTargetSecRaw ? Number(slowTargetSecRaw) : undefined;
  const maxTargets = maxTargetsRaw ? Number(maxTargetsRaw) : undefined;
  const maxTargetBuckets = maxTargetBucketsRaw ? Number(maxTargetBucketsRaw) : undefined;

  const text = await fsp.readFile(log, "utf8");
  const analysis = analyzeVerifyTimingFromLogText({ logPath: log, text });
  const out = formatVerifyTimingAnalysisText(analysis, {
    comment,
    maxBuckets: Number.isFinite(maxBuckets) ? (maxBuckets as number) : undefined,
    slowTargetSec: Number.isFinite(slowTargetSec) ? (slowTargetSec as number) : undefined,
    maxTargets: Number.isFinite(maxTargets) ? (maxTargets as number) : undefined,
    maxTargetBuckets: Number.isFinite(maxTargetBuckets) ? (maxTargetBuckets as number) : undefined,
  });
  process.stdout.write(out + "\n");
  return 0;
}

function isEntrypoint(): boolean {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return import.meta.url === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  process.exit(await main());
}
