import * as fsp from "node:fs/promises";
import os from "node:os";
import {
  processCommandLines,
  processTableLinesDetailed,
  type ProcessInspectionStatus,
} from "../../lib/process-inspection";
import {
  accumulateDiskIoTelemetryLine,
  emptyDiskIoTelemetryCounters,
  type DiskIoTelemetryCounters,
} from "./safety-rails-disk-telemetry";

export type ProcessCounts = {
  total: number;
  node: number;
  buck: number;
  nix: number;
  verifyEnv: number;
};

export type VerifySafetyRailsTelemetrySummary = DiskIoTelemetryCounters & {
  samples: number;
  maxLoad1: number | null;
  maxLoad5: number | null;
  maxProcessCount: number | null;
  maxNodeCount: number | null;
  maxBuckCount: number | null;
  maxNixCount: number | null;
  maxVerifyEnvCount: number | null;
  highLoadTopProcessAttempts: number;
  highLoadTopProcessSuccesses: number;
  highLoadTopProcessUnavailable: number;
  highLoadTopProcessTimeouts: number;
  highLoadTopProcessErrors: number;
  highLoadTopProcessSamples: number;
  highLoadTopProcessLines: string[];
};

export type TopProcessSample = {
  lines: string[];
  retainedLines?: string[];
  status?: ProcessInspectionStatus;
};

type ProcessTableEntry = {
  pid: number;
  ppid: number;
  stat: string;
  pcpu: number;
  command: string;
};

export const TOP_PROCESS_PS_ARGS = ["-A", "-o", "pid=,ppid=,stat=,pcpu=,comm="] as const;

export async function sampleProcessCounts(timeoutMs = 1500): Promise<ProcessCounts | null> {
  const lines = await processCommandLines({
    timeoutMs,
    pgrepPattern:
      "buck2d\\[|\\(buck2-forkserver\\)|(^|/)buck2( |$)|(^|/)node(js)?( |$)|(^|/)nix( |$)|VBR_VERIFY_LOG_FILE=|VBR_VERIFY_PROCESS_STATE_FILE=",
  });
  return lines.length > 0 ? countProcessCommands(lines) : null;
}

function parseProcessTableLine(line: string): ProcessTableEntry | null {
  const match = String(line || "")
    .trim()
    .match(/^(\d+)\s+(\d+)\s+(\S+)\s+([0-9.]+)\s+(.+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  const ppid = Number(match[2]);
  const pcpu = Number(match[4]);
  if (![pid, ppid, pcpu].every(Number.isFinite)) return null;
  return {
    pid,
    ppid,
    stat: match[3] || "?",
    pcpu,
    command: String(match[5] || "").trim(),
  };
}

function truncateCommand(command: string, max = 180): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 3)}...`;
}

export async function sampleTopProcesses(
  timeoutMs = 1500,
  limit = 12,
): Promise<TopProcessSample | null> {
  const result = await processTableLinesDetailed({
    psArgs: [...TOP_PROCESS_PS_ARGS],
    timeoutMs,
    pgrepPattern: "mds|mdworker|fseventsd|mediaanalysisd|nix|buck2|node|rsync|git|du",
    pgrepToLine: (pid, cmd) => `${pid} 0 ? 0 ${cmd}`,
  });
  const entries = result.lines.flatMap((line) => {
    const parsed = parseProcessTableLine(line);
    return parsed ? [parsed] : [];
  });
  if (entries.length === 0) return { lines: [], status: result.status };
  const top = entries
    .sort((a, b) => b.pcpu - a.pcpu)
    .slice(0, Math.max(1, limit))
    .map(
      (entry) =>
        `pid=${entry.pid} ppid=${entry.ppid} stat=${entry.stat} pcpu=${entry.pcpu.toFixed(1)} cmd=${truncateCommand(entry.command)}`,
    );
  return top.length > 0 ? { lines: top, status: "success" } : { lines: [], status: "unavailable" };
}

export function makeRetainedTopProcessSampler(
  sample: () => Promise<TopProcessSample | null> = sampleTopProcesses,
): () => Promise<TopProcessSample> {
  let retainedLines: string[] = [];
  return async () => {
    try {
      const current = await sample();
      const status = current?.status ?? (current?.lines.length ? "success" : "unavailable");
      if (status === "success" && current && current.lines.length > 0) {
        retainedLines = current.lines.slice(0, 12);
      }
      return {
        lines: current?.lines || [],
        retainedLines: status === "success" ? [] : retainedLines,
        status,
      };
    } catch {
      return { lines: [], retainedLines, status: "error" };
    }
  };
}

export function countProcessCommands(lines: string[]): ProcessCounts {
  let node = 0;
  let buck = 0;
  let nix = 0;
  let verifyEnv = 0;
  for (const line of lines) {
    if (/\bnode(?:\s|$)/.test(line) || line.includes("/node ")) node++;
    if (line.includes("buck2") || line.includes("buck2d[")) buck++;
    if (/\bnix(?:\s|$)/.test(line) || line.includes("/nix ")) nix++;
    if (line.includes("VBR_VERIFY_LOG_FILE=") || line.includes("VBR_VERIFY_PROCESS_STATE_FILE=")) {
      verifyEnv++;
    }
  }
  return { total: lines.length, node, buck, nix, verifyEnv };
}

export function formatLoadAvg(): string {
  const [load1, load5, load15] = os.loadavg();
  return `load1=${load1.toFixed(2)} load5=${load5.toFixed(2)} load15=${load15.toFixed(2)}`;
}

export function formatProcessCounts(counts: ProcessCounts | null): string {
  if (!counts) return "process_counts=unavailable";
  return `processes=${counts.total} node=${counts.node} buck=${counts.buck} nix=${counts.nix} verify_env=${counts.verifyEnv}`;
}

export function makeThrottledProcessSampler(
  intervalSec: number,
): () => Promise<ProcessCounts | null> {
  let lastSampleMs = 0;
  let lastSample: ProcessCounts | null = null;
  return async () => {
    const now = Date.now();
    if (lastSampleMs > 0 && now - lastSampleMs < intervalSec * 1000) return lastSample;
    lastSampleMs = now;
    lastSample = await sampleProcessCounts();
    return lastSample;
  };
}

function maxMaybe(cur: number | null, next: number | null): number | null {
  if (next == null || !Number.isFinite(next)) return cur;
  if (cur == null) return next;
  return Math.max(cur, next);
}

function matchNumber(line: string, name: string): number | null {
  const m = new RegExp(`\\b${name}=([0-9]+(?:\\.[0-9]+)?)\\b`).exec(line);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export async function summarizeVerifySafetyRailsTelemetry(
  telemetryPath: string,
): Promise<VerifySafetyRailsTelemetrySummary> {
  const text = await fsp.readFile(telemetryPath, "utf8").catch(() => "");
  const summary: VerifySafetyRailsTelemetrySummary = {
    samples: 0,
    maxLoad1: null,
    maxLoad5: null,
    maxProcessCount: null,
    maxNodeCount: null,
    maxBuckCount: null,
    maxNixCount: null,
    maxVerifyEnvCount: null,
    highLoadTopProcessAttempts: 0,
    highLoadTopProcessSuccesses: 0,
    highLoadTopProcessUnavailable: 0,
    highLoadTopProcessTimeouts: 0,
    highLoadTopProcessErrors: 0,
    highLoadTopProcessSamples: 0,
    highLoadTopProcessLines: [],
    ...emptyDiskIoTelemetryCounters(),
  };
  for (const line of text.split(/\r?\n/)) {
    if (accumulateDiskIoTelemetryLine(summary, line)) continue;
    if (line.startsWith("[verify] high-load top-process sample ")) {
      summary.highLoadTopProcessAttempts++;
      const status = /\bstatus=(success|unavailable|timeout|error)\b/.exec(line)?.[1];
      if (status === "success") summary.highLoadTopProcessSuccesses++;
      if (status === "unavailable") summary.highLoadTopProcessUnavailable++;
      if (status === "timeout") summary.highLoadTopProcessTimeouts++;
      if (status === "error") summary.highLoadTopProcessErrors++;
      continue;
    }
    if (line.startsWith("[verify] high-load top-process ")) {
      summary.highLoadTopProcessSamples++;
      if (summary.highLoadTopProcessLines.length < 12) {
        summary.highLoadTopProcessLines.push(line.slice("[verify] ".length));
      }
      continue;
    }
    if (!line.includes("freeGiB=")) continue;
    summary.samples++;
    summary.maxLoad1 = maxMaybe(summary.maxLoad1, matchNumber(line, "load1"));
    summary.maxLoad5 = maxMaybe(summary.maxLoad5, matchNumber(line, "load5"));
    summary.maxProcessCount = maxMaybe(summary.maxProcessCount, matchNumber(line, "processes"));
    summary.maxNodeCount = maxMaybe(summary.maxNodeCount, matchNumber(line, "node"));
    summary.maxBuckCount = maxMaybe(summary.maxBuckCount, matchNumber(line, "buck"));
    summary.maxNixCount = maxMaybe(summary.maxNixCount, matchNumber(line, "nix"));
    summary.maxVerifyEnvCount = maxMaybe(
      summary.maxVerifyEnvCount,
      matchNumber(line, "verify_env"),
    );
  }
  return summary;
}
