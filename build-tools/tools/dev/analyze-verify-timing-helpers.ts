import { parseLineFromBuckLogForMatching } from "../lib/verify-log-status/parsing.ts";

type TimingBucketAgg = { msTotal: number; count: number };

export type TimingBucket = {
  label: string;
  msTotal: number;
  count: number;
  avgMs: number;
  estWallSec?: number;
};

export type TargetTimingBreakdown = {
  target: string;
  status: "pass" | "fail" | "skip";
  durationSec: number;
  rawDuration: string;
  buckets: TimingBucket[];
};

export type VerifyTimingStats = {
  testsWithDurations: number;
  sumTestDurationsSec: number;
  buckets: TimingBucket[];
  targetTimings: TargetTimingBreakdown[];
};

function normalizeTimingBucketLabel(label: string): string {
  const trimmed = String(label || "").trim();
  const m = /^([A-Za-z0-9_\-]+)\(.*\)$/.exec(trimmed);
  if (!m) return trimmed;
  const head = String(m[1] || "").trim();
  return head ? `${head}(...)` : trimmed;
}

function parseTimingSummaryLine(
  s: string,
): { label: string; msTotal: number; count: number } | null {
  const re =
    /^\[timing\]\s+(\d+(?:\.\d+)?)ms\s+total\s+\((\d+)x,\s+avg\s+(\d+(?:\.\d+)?)ms\):\s+(.+)$/;
  const m = re.exec(s.trim());
  if (!m) return null;
  const msTotal = Number(m[1]);
  const count = Number(m[2]);
  const label = normalizeTimingBucketLabel(String(m[4] || "").trim());
  if (!label || !Number.isFinite(msTotal) || !Number.isFinite(count)) return null;
  return { label, msTotal, count };
}

function parseTimingDetailLine(
  s: string,
): { label: string; msTotal: number; count: number } | null {
  const re = /^\[timing\]\s+(.+):\s+(\d+(?:\.\d+)?)ms$/;
  const m = re.exec(s.trim());
  if (!m) return null;
  const label = normalizeTimingBucketLabel(String(m[1] || "").trim());
  const msTotal = Number(m[2]);
  if (!label || !Number.isFinite(msTotal)) return null;
  return { label, msTotal, count: 1 };
}

function parseBuckCompletionDurationSec(line: string): number | null {
  const durRe = /\((\d+(?:\.\d+)?)(ms|s)\)\s*$/;
  const m = durRe.exec(line.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return m[2] === "ms" ? n / 1000 : n;
}

function parseBuckCompletion(line: string): TargetTimingBreakdown | null {
  const m = /^(✓ Pass:|✗ Fail:|Skip:)\s+(\S+)\s+\(([^)]+)\)\s*$/.exec(line.trim());
  if (!m) return null;
  const rawDuration = String(m[3] || "").trim();
  const durationSec = parseBuckCompletionDurationSec(`(${rawDuration})`);
  if (durationSec === null) return null;
  return {
    status: m[1] === "✓ Pass:" ? "pass" : m[1] === "✗ Fail:" ? "fail" : "skip",
    target: String(m[2] || "").trim(),
    durationSec,
    rawDuration,
    buckets: [],
  };
}

function addTimingAgg(
  map: Map<string, TimingBucketAgg>,
  parsed: { label: string; msTotal: number; count: number },
): void {
  const cur = map.get(parsed.label) || { msTotal: 0, count: 0 };
  cur.msTotal += parsed.msTotal;
  cur.count += parsed.count;
  map.set(parsed.label, cur);
}

function materializeBuckets(opts: {
  summaryAgg: Map<string, TimingBucketAgg>;
  detailAgg: Map<string, TimingBucketAgg>;
  effectiveParallelism?: number;
}): TimingBucket[] {
  const combined = new Map<string, TimingBucketAgg>();
  for (const [label, agg] of opts.detailAgg.entries()) combined.set(label, { ...agg });
  for (const [label, agg] of opts.summaryAgg.entries()) combined.set(label, { ...agg });
  return Array.from(combined.entries())
    .map(([label, agg]) => {
      const avgMs = agg.count > 0 ? agg.msTotal / agg.count : 0;
      const estWallSec =
        opts.effectiveParallelism !== undefined && opts.effectiveParallelism > 0
          ? agg.msTotal / 1000 / opts.effectiveParallelism
          : undefined;
      return { label, msTotal: agg.msTotal, count: agg.count, avgMs, estWallSec };
    })
    .sort((a, b) => b.msTotal - a.msTotal);
}

function hasTimingAgg(
  summaryAgg: Map<string, TimingBucketAgg>,
  detailAgg: Map<string, TimingBucketAgg>,
): boolean {
  return summaryAgg.size > 0 || detailAgg.size > 0;
}

function collectTargetTimings(
  window: string[],
  effectiveParallelism?: number,
): TargetTimingBreakdown[] {
  const out: TargetTimingBreakdown[] = [];
  let pendingSummaryAgg: Map<string, TimingBucketAgg> = new Map();
  let pendingDetailAgg: Map<string, TimingBucketAgg> = new Map();

  for (const raw of window) {
    const { normalized } = parseLineFromBuckLogForMatching(raw);
    const summary = parseTimingSummaryLine(normalized);
    if (summary) {
      addTimingAgg(pendingSummaryAgg, summary);
      continue;
    }
    const detail = parseTimingDetailLine(normalized);
    if (detail) {
      addTimingAgg(pendingDetailAgg, detail);
      continue;
    }
    const completion = parseBuckCompletion(normalized);
    if (!completion || !hasTimingAgg(pendingSummaryAgg, pendingDetailAgg)) continue;
    completion.buckets = materializeBuckets({
      summaryAgg: pendingSummaryAgg,
      detailAgg: pendingDetailAgg,
      effectiveParallelism,
    });
    out.push(completion);
    pendingSummaryAgg = new Map();
    pendingDetailAgg = new Map();
  }

  return out.sort((a, b) => b.durationSec - a.durationSec);
}

export function collectVerifyTimingStats(
  window: string[],
  effectiveParallelism?: number,
): VerifyTimingStats {
  let testsWithDurations = 0;
  let sumTestDurationsSec = 0;
  const timingSummaryAgg: Map<string, TimingBucketAgg> = new Map();
  const timingDetailAgg: Map<string, TimingBucketAgg> = new Map();

  for (const raw of window) {
    const { normalized, isComment } = parseLineFromBuckLogForMatching(raw);
    if (!isComment) {
      const duration = parseBuckCompletionDurationSec(normalized);
      if (duration !== null) {
        testsWithDurations++;
        sumTestDurationsSec += duration;
      }
    }
    const summary = parseTimingSummaryLine(normalized);
    if (summary) {
      addTimingAgg(timingSummaryAgg, summary);
      continue;
    }
    const detail = parseTimingDetailLine(normalized);
    if (detail) addTimingAgg(timingDetailAgg, detail);
  }

  return {
    testsWithDurations,
    sumTestDurationsSec,
    buckets: materializeBuckets({
      summaryAgg: timingSummaryAgg,
      detailAgg: timingDetailAgg,
      effectiveParallelism,
    }),
    targetTimings: collectTargetTimings(window, effectiveParallelism),
  };
}
