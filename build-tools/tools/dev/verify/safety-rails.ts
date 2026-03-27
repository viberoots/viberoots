import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { resolveToolPath } from "../../lib/tool-paths.ts";
import { activeNixGcProcesses } from "./preflight.ts";

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

async function appendLine(p: string, line: string): Promise<void> {
  await fsp.appendFile(p, line.endsWith("\n") ? line : line + "\n", "utf8").catch(() => {});
}

export type VerifySafetyRailsSnapshotDeps = {
  sampleDfText: () => Promise<string>;
};

export async function writeVerifySafetyRailsTriggerSnapshot(
  dir: string,
  reason: string,
  deps?: Partial<VerifySafetyRailsSnapshotDeps>,
): Promise<void> {
  const out = path.join(dir, "trigger-snapshot.txt");
  await appendLine(out, `[verify] safety-rails trigger: ${reason}\n`);
  const sampleDfText =
    deps?.sampleDfText ??
    (async () => {
      try {
        const res = await $({ stdio: "pipe", reject: false })`df -Pk . /nix/store`;
        return String(res.stdout || "");
      } catch {
        return "";
      }
    });
  const dfText = await sampleDfText();
  if (dfText.trim()) await appendLine(out, dfText);
}

export type VerifySafetyRailsDecision = {
  shouldStop: boolean;
  reason: string;
};

export function decideVerifySafetyRailsTrigger(opts: {
  baseFreeGiB: number;
  curFreeGiB: number;
  lowSpaceGiB: number;
  dropBudgetGiB: number;
}): VerifySafetyRailsDecision | null {
  if (opts.lowSpaceGiB > 0 && opts.curFreeGiB < opts.lowSpaceGiB) {
    return {
      shouldStop: true,
      reason: `/nix/store free dropped below VERIFY_LOW_SPACE_GB (${opts.curFreeGiB} < ${opts.lowSpaceGiB})`,
    };
  }
  const dropGiB = opts.baseFreeGiB - opts.curFreeGiB;
  if (opts.dropBudgetGiB > 0 && dropGiB > opts.dropBudgetGiB) {
    return {
      shouldStop: true,
      reason: `/nix/store free drop exceeded budget VERIFY_NIX_DROP_BUDGET_GB (drop=${dropGiB}GiB > ${opts.dropBudgetGiB}GiB)`,
    };
  }
  return null;
}

export type VerifySafetyRailsPollDeps = {
  freeGiBForPath: (p: string) => Promise<number | null>;
  writeSnapshot: (dir: string, reason: string) => Promise<void>;
  onTrigger: (reason: string) => Promise<void>;
  killProcessGroup: (processGroupIdToKill: number, signal: NodeJS.Signals) => void;
  setTimeoutFn: (fn: () => void, ms: number) => void;
  activeNixGcProcesses: () => Promise<Array<{ pid: number; command: string }>>;
};

export async function pollVerifySafetyRailsOnce(opts: {
  analysisDir: string;
  processGroupIdToKill: number;
  baseFreeGiB: number;
  lowSpaceGiB: number;
  dropBudgetGiB: number;
  telemetryPath: string;
  deps: VerifySafetyRailsPollDeps;
}): Promise<VerifySafetyRailsDecision | null> {
  const cur = await opts.deps.freeGiBForPath("/nix/store");
  if (cur == null) return null;
  await appendLine(opts.telemetryPath, `${Date.now()} freeGiB=${cur}`);

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
    baseFreeGiB: opts.baseFreeGiB,
    curFreeGiB: cur,
    lowSpaceGiB: opts.lowSpaceGiB,
    dropBudgetGiB: opts.dropBudgetGiB,
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
}): Promise<{ stop: () => void }> {
  const lowSpace = defaultOrNonNegative(parseNum(process.env.VERIFY_LOW_SPACE_GB), 5);
  const dropBudget = defaultOrNonNegative(parseNum(process.env.VERIFY_NIX_DROP_BUDGET_GB), 20);
  const intervalSec = defaultOrAtLeast(parseNum(process.env.VERIFY_SAFETY_RAILS_POLL_SECS), 5, 1);

  const base = await freeGiBForPath("/nix/store");
  if (base == null) {
    return { stop: () => {} };
  }

  await fsp.mkdir(opts.analysisDir, { recursive: true }).catch(() => {});
  const telemetry = path.join(opts.analysisDir, "nix-store-telemetry.log");
  await appendLine(telemetry, `[verify] safety-rails baseline /nix/store free ~${base}GiB`);

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
  const timer = setInterval(() => {
    void (async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      if (stopped) return;
      try {
        if (stopped) return;
        const decision = await pollVerifySafetyRailsOnce({
          analysisDir: opts.analysisDir,
          processGroupIdToKill: opts.processGroupIdToKill,
          baseFreeGiB: base,
          lowSpaceGiB: lowSpace,
          dropBudgetGiB: dropBudget,
          telemetryPath: telemetry,
          deps: {
            freeGiBForPath,
            writeSnapshot: async (dir, reason) =>
              writeVerifySafetyRailsTriggerSnapshot(dir, reason),
            onTrigger: async (reason) => {
              await opts.onTrigger?.(reason);
            },
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
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
