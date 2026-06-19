import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { resolveToolPath } from "../../lib/tool-paths";
import { activeNixGcProcesses } from "./preflight";
import { writeVerifySafetyRailsTriggerSnapshot } from "./safety-rails-snapshot";
import {
  formatLoadAvg,
  formatProcessCounts,
  makeThrottledProcessSampler,
  summarizeVerifySafetyRailsTelemetry,
  type ProcessCounts,
} from "./safety-rails-telemetry";

export { summarizeVerifySafetyRailsTelemetry, writeVerifySafetyRailsTriggerSnapshot };

function parseNum(s: string | undefined): number | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function defaultOrNonNegative(envVal: number | null, def: number): number {
  if (envVal == null) return def;
  if (!Number.isFinite(envVal)) return def;
  return Math.max(0, envVal);
}

function defaultOrAtLeast(envVal: number | null, def: number, min: number): number {
  if (envVal == null || !Number.isFinite(envVal)) return Math.max(min, def);
  return Math.max(min, envVal);
}

async function freeGiBForPath(p: string): Promise<number | null> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`df -Pk ${p} | tail -n1`;
    const line = String(stdout || "").trim();
    const toks = line.split(/\s+/);
    const availKB = Number(toks[3] || "0");
    return Math.max(0, Math.floor(availKB / 1024 / 1024));
  } catch {
    return null;
  }
}

async function dirGiBForPath(p: string): Promise<number> {
  const root = String(p || "").trim();
  if (!root) return 0;
  try {
    const { stdout } = await $({
      stdio: "pipe",
      reject: false,
    })`bash --noprofile --norc -c ${'du -sk "$1" 2>/dev/null || true'} _ ${root}`;
    const line = String(stdout || "").trim();
    const toks = line.split(/\s+/);
    const usedKB = Number(toks[0] || "0");
    if (!Number.isFinite(usedKB) || usedKB <= 0) return 0;
    return Math.max(0, Math.floor(usedKB / 1024 / 1024));
  } catch {
    return 0;
  }
}

async function appendLine(p: string, line: string): Promise<void> {
  await fsp.appendFile(p, line.endsWith("\n") ? line : line + "\n", "utf8").catch(() => {});
}

export type VerifySafetyRailsDecision = {
  shouldStop: boolean;
  reason: string;
};

export function decideVerifySafetyRailsTrigger(opts: {
  curFreeGiB: number;
  lowSpaceGiB: number;
}): VerifySafetyRailsDecision | null {
  if (opts.lowSpaceGiB > 0 && opts.curFreeGiB < opts.lowSpaceGiB) {
    return {
      shouldStop: true,
      reason: `/nix/store free dropped below VERIFY_LOW_SPACE_GB (${opts.curFreeGiB} < ${opts.lowSpaceGiB})`,
    };
  }
  return null;
}

export type VerifySafetyRailsPollDeps = {
  freeGiBForPath: (p: string) => Promise<number | null>;
  transientGiBForPath?: (p: string) => Promise<number>;
  sampleProcessCounts?: () => Promise<ProcessCounts | null>;
  writeSnapshot: (dir: string, reason: string) => Promise<void>;
  onTrigger: (reason: string) => Promise<void>;
  killProcessGroup: (processGroupIdToKill: number, signal: NodeJS.Signals) => void;
  setTimeoutFn: (fn: () => void, ms: number) => void;
  activeNixGcProcesses: () => Promise<Array<{ pid: number; command: string }>>;
};

export async function pollVerifySafetyRailsOnce(opts: {
  analysisDir: string;
  processGroupIdToKill: number;
  transientRoot?: string;
  lowSpaceGiB: number;
  telemetryPath: string;
  deps: VerifySafetyRailsPollDeps;
}): Promise<VerifySafetyRailsDecision | null> {
  const cur = await opts.deps.freeGiBForPath("/nix/store");
  if (cur == null) return null;
  const curTransientGiB =
    opts.transientRoot && opts.deps.transientGiBForPath
      ? await opts.deps.transientGiBForPath(opts.transientRoot).catch(() => 0)
      : 0;
  const processCounts = opts.deps.sampleProcessCounts
    ? await opts.deps.sampleProcessCounts().catch(() => null)
    : null;
  await appendLine(
    opts.telemetryPath,
    `${Date.now()} freeGiB=${cur} transientGiB=${curTransientGiB} reclaimableFreeGiB=${cur + curTransientGiB} ${formatLoadAvg()} ${formatProcessCounts(processCounts)}`,
  );

  const activeGc = await opts.deps.activeNixGcProcesses();
  if (activeGc.length > 0) {
    const sample = activeGc
      .slice(0, 3)
      .map((p) => `${p.pid}:${p.command.slice(0, 120)}`)
      .join(" | ");
    const note = `active nix gc process detected during verify (${activeGc.length}): ${sample}`;
    await opts.deps.onTrigger(`[notice] ${note}`);
    await appendLine(opts.telemetryPath, `[verify] safety-rails notice: ${note}`);
  }

  const decision = decideVerifySafetyRailsTrigger({
    curFreeGiB: cur,
    lowSpaceGiB: opts.lowSpaceGiB,
  });
  if (!decision) return null;

  await opts.deps.onTrigger(decision.reason);
  await opts.deps.writeSnapshot(opts.analysisDir, decision.reason);
  try {
    opts.deps.killProcessGroup(opts.processGroupIdToKill, "SIGTERM");
  } catch {}
  opts.deps.setTimeoutFn(() => {
    try {
      opts.deps.killProcessGroup(opts.processGroupIdToKill, "SIGKILL");
    } catch {}
  }, 10_000);
  return decision;
}

export async function startVerifySafetyRails(opts: {
  root: string;
  analysisDir: string;
  processGroupIdToKill: number;
  onTrigger?: (reason: string) => Promise<void>;
}): Promise<{ stop: () => void; telemetryPath: string | null }> {
  const lowSpace = defaultOrNonNegative(parseNum(process.env.VERIFY_LOW_SPACE_GB), 5);
  const intervalSec = defaultOrAtLeast(parseNum(process.env.VERIFY_SAFETY_RAILS_POLL_SECS), 5, 1);
  const processSampleSec = defaultOrAtLeast(
    parseNum(process.env.VERIFY_SAFETY_RAILS_PROCESS_SAMPLE_SECS),
    60,
    5,
  );

  const base = await freeGiBForPath("/nix/store");
  if (base == null) {
    return { stop: () => {}, telemetryPath: null };
  }
  const transientRoot = String(process.env.TMPDIR || "").trim();
  const baseTransientGiB = transientRoot ? await dirGiBForPath(transientRoot) : 0;

  await fsp.mkdir(opts.analysisDir, { recursive: true }).catch(() => {});
  const telemetry = path.join(opts.analysisDir, "nix-store-telemetry.log");
  await appendLine(telemetry, `[verify] safety-rails baseline /nix/store free ~${base}GiB`);
  await appendLine(
    telemetry,
    `[verify] safety-rails baseline transient root ${transientRoot || "<none>"} ~${baseTransientGiB}GiB`,
  );
  await appendLine(
    telemetry,
    `${Date.now()} freeGiB=${base} transientGiB=${baseTransientGiB} reclaimableFreeGiB=${base + baseTransientGiB} ${formatLoadAvg()} ${formatProcessCounts(null)}`,
  );

  if ((process.env.VERIFY_ANALYSIS_STORE_TOTALS || "").trim() === "1") {
    const timeoutPath = await resolveToolPath("timeout");
    const res = await $({
      stdio: "pipe",
      cwd: opts.root,
      reject: false,
    })`${timeoutPath} -k 5s 20s nix store info`;
    const txt = String(res.stdout || "").trim();
    if (txt) await appendLine(telemetry, `[verify] nix store info:\n${txt}`);
  }

  let stopped = false;
  let pollInFlight = false;
  const throttledProcessSample = makeThrottledProcessSampler(processSampleSec);
  const timer = setInterval(() => {
    void (async () => {
      if (stopped) return;
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        if (stopped) return;
        const decision = await pollVerifySafetyRailsOnce({
          analysisDir: opts.analysisDir,
          processGroupIdToKill: opts.processGroupIdToKill,
          transientRoot,
          lowSpaceGiB: lowSpace,
          telemetryPath: telemetry,
          deps: {
            freeGiBForPath,
            transientGiBForPath: dirGiBForPath,
            writeSnapshot: async (dir, reason) =>
              writeVerifySafetyRailsTriggerSnapshot(dir, reason),
            onTrigger: async (reason) => {
              await opts.onTrigger?.(reason);
            },
            sampleProcessCounts: throttledProcessSample,
            killProcessGroup: (pgid, signal) => {
              process.kill(-pgid, signal);
            },
            setTimeoutFn: (fn, ms) => {
              setTimeout(fn, ms);
            },
            activeNixGcProcesses,
          },
        });
        if (decision) stopped = true;
      } finally {
        pollInFlight = false;
      }
    })();
  }, intervalSec * 1000);
  timer.unref?.();

  return {
    telemetryPath: telemetry,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
