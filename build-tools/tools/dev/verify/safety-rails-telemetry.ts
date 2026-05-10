import * as fsp from "node:fs/promises";
import os from "node:os";
import { processCommandLines } from "../../lib/process-inspection";

export type ProcessCounts = {
  total: number;
  node: number;
  buck: number;
  nix: number;
  verifyEnv: number;
};

export type VerifySafetyRailsTelemetrySummary = {
  samples: number;
  maxLoad1: number | null;
  maxLoad5: number | null;
  maxProcessCount: number | null;
  maxNodeCount: number | null;
  maxBuckCount: number | null;
  maxNixCount: number | null;
  maxVerifyEnvCount: number | null;
};

export async function sampleProcessCounts(timeoutMs = 1500): Promise<ProcessCounts | null> {
  const lines = await processCommandLines({
    timeoutMs,
    pgrepPattern:
      "buck2d\\[|\\(buck2-forkserver\\)|(^|/)buck2( |$)|(^|/)node(js)?( |$)|(^|/)nix( |$)|VBR_VERIFY_LOG_FILE=|VBR_VERIFY_PROCESS_STATE_FILE=",
  });
  return lines.length > 0 ? countProcessCommands(lines) : null;
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
  };
  for (const line of text.split(/\r?\n/)) {
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
