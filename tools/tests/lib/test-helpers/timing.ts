import "./worker-init";
import { performance } from "node:perf_hooks";

type TimingAgg = { msTotal: number; count: number };

const TIMING_MODE = String(process.env.TEST_TIMING || "").trim();
const ENABLE_TIMING = TIMING_MODE === "1" || TIMING_MODE === "summary";
const ENABLE_TIMING_DETAIL = TIMING_MODE === "1";
const ENABLE_TIMING_SUMMARY = TIMING_MODE === "summary" || process.env.TEST_TIMING_SUMMARY === "1";

const timingAgg: Map<string, TimingAgg> = new Map();

function recordTiming(label: string, ms: number) {
  if (!ENABLE_TIMING) return;
  const cur = timingAgg.get(label) || { msTotal: 0, count: 0 };
  cur.msTotal += ms;
  cur.count += 1;
  timingAgg.set(label, cur);
  if (!ENABLE_TIMING_DETAIL) return;
  try {
    console.error(`[timing] ${label}: ${ms.toFixed(1)}ms`);
  } catch {}
}

process.on("exit", () => {
  if (!ENABLE_TIMING_SUMMARY) return;
  try {
    const rows = Array.from(timingAgg.entries())
      .map(([label, agg]) => ({
        label,
        msTotal: agg.msTotal,
        count: agg.count,
        avgMs: agg.count > 0 ? agg.msTotal / agg.count : 0,
      }))
      .sort((a, b) => b.msTotal - a.msTotal);
    if (rows.length === 0) return;
    console.error("[timing] summary (sorted by total):");
    for (const r of rows.slice(0, 30)) {
      console.error(
        `[timing] ${r.msTotal.toFixed(1)}ms total  (${r.count}x, avg ${r.avgMs.toFixed(1)}ms): ${r.label}`,
      );
    }
    if (rows.length > 30) {
      console.error(`[timing] ... ${rows.length - 30} more`);
    }
  } catch {}
});

export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    recordTiming(label, performance.now() - t0);
  }
}

export function getTimingCountForLabel(label: string): number {
  return timingAgg.get(label)?.count ?? 0;
}
