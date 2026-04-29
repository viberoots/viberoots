import path from "node:path";
import process from "node:process";
import { isPidAlive } from "./buck-orphan-cleanup-lib";
import { readProcessIdentity } from "./owned-process-state";
import {
  dedupeByProcessGroup,
  etimeToSeconds,
  mergeWithLiveProcessRows,
  ownerPidFromStateFile,
  parseEnvVerifyProcesses,
  parseProcessRows,
  psLinesWithEnv,
  readRegisteredProcessesFromStateFiles,
  type EnvVerifyProc,
} from "./verify-owned-process-scan";

export { etimeToSeconds } from "./verify-owned-process-scan";

async function signalVerifyProcessGroup(
  proc: EnvVerifyProc,
  opts: {
    log?: (line: string) => Promise<void>;
    reason: "cleanup" | "orphan cleanup";
  },
): Promise<boolean> {
  try {
    process.kill(-proc.pgid, "SIGTERM");
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (isPidAlive(proc.pid)) {
    try {
      process.kill(-proc.pgid, "SIGKILL");
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!isPidAlive(proc.pid)) {
    if (opts.log) {
      await opts.log(
        `[verify] env-process ${opts.reason}: killed pid=${proc.pid} pgid=${proc.pgid} etime=${proc.etime} target=${proc.target || "(unknown)"} cmd=${proc.commandSummary || "(unknown)"} log=${proc.logFile}`,
      );
    }
    return true;
  }
  return false;
}

export async function cleanupCurrentVerifyEnvProcesses(opts: {
  stateFile: string;
  logFile: string | null;
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const rawStateFile = String(opts.stateFile || "").trim();
  const rawLogFile = opts.logFile ? String(opts.logFile).trim() : "";
  if (!rawStateFile || !rawLogFile) return { scanned: 0, candidates: 0, killed: 0 };
  const stateFile = path.resolve(rawStateFile);
  const logFile = path.resolve(rawLogFile);
  const maxKills = Math.max(0, opts.maxKills ?? 200);
  // Buck can report a test complete while zx_test wrapper helpers are still
  // unwinding. Give normal teardown a brief chance to finish before treating
  // same-run env-bearing processes as leaks.
  await new Promise((resolve) => setTimeout(resolve, 750));
  const lines = await psLinesWithEnv(2500);
  const scanned = dedupeByProcessGroup(parseEnvVerifyProcesses(lines));
  const procs = scanned.filter(
    (proc) => path.resolve(proc.stateFile) === stateFile && path.resolve(proc.logFile) === logFile,
  );
  let killed = 0;
  for (const proc of procs) {
    if (killed >= maxKills) break;
    if (await signalVerifyProcessGroup(proc, { log: opts.log, reason: "cleanup" })) killed++;
  }
  return { scanned: scanned.length, candidates: procs.length, killed };
}

async function cleanupOrphanVerifyEnvProcesses(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
  staleGraceSec: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 50);
  const lines = await psLinesWithEnv(2500);
  const procs = dedupeByProcessGroup(parseEnvVerifyProcesses(lines)).filter((proc) => {
    const ownerPid = ownerPidFromStateFile(proc.stateFile);
    if (!ownerPid || isPidAlive(ownerPid)) return false;
    return true;
  });
  let candidates = 0;
  let killed = 0;
  for (const proc of procs) {
    const orphan = proc.ppid <= 1 || !isPidAlive(proc.ppid);
    if (!orphan) continue;
    if (etimeToSeconds(proc.etime) < opts.staleGraceSec) continue;
    candidates++;
    if (killed >= maxKills) continue;
    if (await signalVerifyProcessGroup(proc, { log: opts.log, reason: "orphan cleanup" })) killed++;
  }
  return { scanned: procs.length, candidates, killed };
}

export async function cleanupOrphanVerifyProcesses(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 50);
  const staleGraceRaw = Number.parseInt(
    String(process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS || "120"),
    10,
  );
  const staleGraceSec = Math.max(0, Number.isFinite(staleGraceRaw) ? staleGraceRaw : 120);
  const lines = await psLinesWithEnv(2500);
  const liveRows = parseProcessRows(lines);
  const registered = await readRegisteredProcessesFromStateFiles();
  const procs = mergeWithLiveProcessRows(registered, liveRows);
  const envRes = await cleanupOrphanVerifyEnvProcesses({
    log: opts.log,
    maxKills,
    staleGraceSec,
  }).catch(() => ({ scanned: 0, candidates: 0, killed: 0 }));
  let candidates = 0;
  let killed = 0;
  for (const proc of procs) {
    const orphan = proc.ppid <= 1 || !isPidAlive(proc.ppid);
    if (!orphan) continue;
    if (etimeToSeconds(proc.etime) < staleGraceSec) continue;
    candidates++;
    if (killed >= maxKills) continue;
    const current = await readProcessIdentity(proc.pid).catch(() => null);
    if (!current || current.pgid !== proc.pgid) continue;
    if (current.startSig !== proc.startSig) continue;
    if (await signalVerifyProcessGroup(proc, { log: opts.log, reason: "orphan cleanup" })) {
      killed++;
    }
  }
  return {
    scanned: procs.length + envRes.scanned,
    candidates: candidates + envRes.candidates,
    killed: killed + envRes.killed,
  };
}
