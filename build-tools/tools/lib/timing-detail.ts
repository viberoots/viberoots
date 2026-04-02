import { performance } from "node:perf_hooks";

function timingDetailEnabled(): boolean {
  const mode = String(process.env.TEST_TIMING || "").trim();
  return mode === "1" || mode === "summary" || process.env.TEST_TIMING_SUMMARY === "1";
}

export function emitTimingDetail(label: string, ms: number): void {
  if (!timingDetailEnabled()) return;
  try {
    console.error(`[timing] ${label}: ${ms.toFixed(1)}ms`);
  } catch {}
}

export async function timeAsyncDetail<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    emitTimingDetail(label, performance.now() - t0);
  }
}
