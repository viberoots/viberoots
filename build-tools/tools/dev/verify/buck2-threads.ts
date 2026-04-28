import os from "node:os";
import process from "node:process";

export type VerifyBuck2ThreadsOptions = {
  env?: NodeJS.ProcessEnv;
  cpuCount?: number;
  targetCount?: number;
};

export function verifyBuck2Threads(opts: VerifyBuck2ThreadsOptions = {}): number {
  const env = opts.env ?? process.env;
  const raw = String(env.VERIFY_BUCK2_THREADS || "").trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  // Default: keep concurrency moderate to avoid temp-repo seed copy storms and buck daemon churn.
  // Users can override via VERIFY_BUCK2_THREADS.
  //
  // CI can set VERIFY_BUCK2_THREADS explicitly, or rely on buck2 defaults (no --num-threads)
  // by returning 0 below.
  const isCi = String(env.CI || "").trim() === "1" || String(env.CI || "").trim() === "true";
  if (isCi) return 0;
  const cores = Math.max(1, opts.cpuCount ?? os.cpus()?.length ?? 1);
  // Empirical default: ~2x cores with a tighter cap is more stable for local verify workloads
  // that run many runInTemp-based tests concurrently.
  const moderate = Math.ceil(cores * 2);
  const targetCount = Math.max(0, Math.floor(opts.targetCount ?? 0));
  const localCap = targetCount >= 500 ? 8 : targetCount >= 100 ? 12 : 20;
  return Math.max(1, Math.min(localCap, moderate));
}
