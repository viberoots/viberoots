import { stripAnsiAndCrs } from "../lib/verify-log-status/types";

export type VerifyPhaseTiming = {
  name: string;
  durationMs: number;
};

export type VerifyResourceSummary = {
  pass: string;
  samples: number;
  maxLoad1?: number;
  maxLoad5?: number;
  maxProcesses?: number;
  maxNode?: number;
  maxBuck?: number;
  maxNix?: number;
  maxVerifyEnv?: number;
};

function parseMaybeNumber(value: string | undefined): number | undefined {
  if (!value || value === "?") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function collectResourceSummaries(lines: string[]): VerifyResourceSummary[] {
  const out: VerifyResourceSummary[] = [];
  const re =
    /^\[verify\] resource summary pass=(\S+) samples=(\d+) max_load1=(\S+) max_load5=(\S+) max_processes=(\S+) max_node=(\S+) max_buck=(\S+) max_nix=(\S+) max_verify_env=(\S+)$/;
  for (const raw of lines) {
    const line = stripAnsiAndCrs(raw).trim();
    const m = re.exec(line);
    if (!m) continue;
    out.push({
      pass: m[1] || "unknown",
      samples: Number(m[2] || "0"),
      maxLoad1: parseMaybeNumber(m[3]),
      maxLoad5: parseMaybeNumber(m[4]),
      maxProcesses: parseMaybeNumber(m[5]),
      maxNode: parseMaybeNumber(m[6]),
      maxBuck: parseMaybeNumber(m[7]),
      maxNix: parseMaybeNumber(m[8]),
      maxVerifyEnv: parseMaybeNumber(m[9]),
    });
  }
  return out;
}

export function collectPhaseTimings(lines: string[]): VerifyPhaseTiming[] {
  const out: VerifyPhaseTiming[] = [];
  const re = /^\[verify\] phase name=(\S+) duration_ms=(\d+)$/;
  for (const raw of lines) {
    const line = stripAnsiAndCrs(raw).trim();
    const m = re.exec(line);
    if (!m) continue;
    const durationMs = Number(m[2] || "0");
    if (!Number.isFinite(durationMs)) continue;
    out.push({ name: m[1] || "unknown", durationMs });
  }
  return out;
}
