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
  parseLineFromBuckLogForMatching,
} from "../lib/verify-log-status/parsing.ts";

type TimingBucketAgg = { msTotal: number; count: number };

export type VerifyTimingAnalysis = {
  logPath: string;
  wallSec?: number;
  beginEpochSec?: number;
  endEpochSec?: number;
  testsWithDurations: number;
  sumTestDurationsSec: number;
  effectiveParallelism?: number;
  buckets: Array<{
    label: string;
    msTotal: number;
    count: number;
    avgMs: number;
    estWallSec?: number;
  }>;
};

function normalizeTimingBucketLabel(label: string): string {
  // Many timing labels include per-test identifiers in parentheses, e.g.:
  // - rsyncRepoTo(tmp-XXXX)
  // - cloneSeedRepoTo(tmp-YYYY)
  // For suite-level aggregation, collapse these to a stable form:
  // - rsyncRepoTo(...)
  const trimmed = String(label || "").trim();
  const m = /^([A-Za-z0-9_\-]+)\(.*\)$/.exec(trimmed);
  if (!m) return trimmed;
  const head = String(m[1] || "").trim();
  return head ? `${head}(...)` : trimmed;
}

function parseTimingSummaryLine(
  s: string,
): { label: string; msTotal: number; count: number } | null {
  // [timing] 1392.1ms total  (511x, avg 2.7ms): rsyncRepoTo(tmp-abc)
  const re =
    /^\[timing\]\s+(\d+(?:\.\d+)?)ms\s+total\s+\((\d+)x,\s+avg\s+(\d+(?:\.\d+)?)ms\):\s+(.+)$/;
  const m = re.exec(s.trim());
  if (!m) return null;
  const msTotal = Number(m[1]);
  const count = Number(m[2]);
  const label = normalizeTimingBucketLabel(String(m[4] || "").trim());
  if (!label) return null;
  if (!Number.isFinite(msTotal) || !Number.isFinite(count)) return null;
  return { label, msTotal, count };
}

function parseBuckCompletionDurationSec(line: string): number | null {
  // Examples:
  // ✓ Pass: root//:some_test (1.0s)
  // ✗ Fail: root//:some_test (12.34s)
  // Skip: root//:some_test (0.1s)
  const durRe = /\((\d+(?:\.\d+)?)(ms|s)\)\s*$/;
  const m = durRe.exec(line.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = m[2];
  return unit === "ms" ? n / 1000 : n;
}

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

  let testsWithDurations = 0;
  let sumTestDurationsSec = 0;
  for (const raw of window) {
    const { normalized, isComment } = parseLineFromBuckLogForMatching(raw);
    if (isComment) continue;
    const d = parseBuckCompletionDurationSec(normalized);
    if (d === null) continue;
    testsWithDurations++;
    sumTestDurationsSec += d;
  }

  const effectiveParallelism =
    wallSec !== undefined && wallSec > 0 && sumTestDurationsSec > 0
      ? sumTestDurationsSec / wallSec
      : undefined;

  const timingAgg: Map<string, TimingBucketAgg> = new Map();
  for (const raw of window) {
    const { normalized } = parseLineFromBuckLogForMatching(raw);
    const parsed = parseTimingSummaryLine(normalized);
    if (!parsed) continue;
    const cur = timingAgg.get(parsed.label) || { msTotal: 0, count: 0 };
    cur.msTotal += parsed.msTotal;
    cur.count += parsed.count;
    timingAgg.set(parsed.label, cur);
  }

  const buckets = Array.from(timingAgg.entries())
    .map(([label, agg]) => {
      const avgMs = agg.count > 0 ? agg.msTotal / agg.count : 0;
      const estWallSec =
        effectiveParallelism !== undefined && effectiveParallelism > 0
          ? agg.msTotal / 1000 / effectiveParallelism
          : undefined;
      return {
        label,
        msTotal: agg.msTotal,
        count: agg.count,
        avgMs,
        estWallSec,
      };
    })
    .sort((a, b) => b.msTotal - a.msTotal);

  return {
    logPath: path.normalize(opts.logPath),
    wallSec,
    beginEpochSec: begin,
    endEpochSec: end,
    testsWithDurations,
    sumTestDurationsSec,
    effectiveParallelism,
    buckets,
  };
}

export function formatVerifyTimingAnalysisText(
  a: VerifyTimingAnalysis,
  opts?: { maxBuckets?: number; comment?: boolean },
): string {
  const maxBuckets = opts?.maxBuckets ?? 15;
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

  const text = await fsp.readFile(log, "utf8");
  const analysis = analyzeVerifyTimingFromLogText({ logPath: log, text });
  const out = formatVerifyTimingAnalysisText(analysis, {
    comment,
    maxBuckets: Number.isFinite(maxBuckets) ? (maxBuckets as number) : undefined,
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
