import * as fsp from "node:fs/promises";
import os from "node:os";
import { processTableLines } from "../../lib/process-inspection";

export type VerifyProcessSnapshot = {
  total: number;
  node: number;
  buck: number;
  nix: number;
  buckLines: string[];
};

function truncateDiagnosticLine(line: string, max = 360): string {
  const normalized = line.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

export function summarizeVerifyProcessSnapshot(lines: string[]): VerifyProcessSnapshot {
  let node = 0;
  let buck = 0;
  let nix = 0;
  const buckLines: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/\bnode(?:\s|$)/.test(line) || line.includes("/node ")) node++;
    if (line.includes("buck2") || line.includes("buck2d[")) {
      buck++;
      buckLines.push(truncateDiagnosticLine(line));
    }
    if (/\bnix(?:\s|$)/.test(line) || line.includes("/nix ")) nix++;
  }
  return { total: lines.filter((line) => line.trim()).length, node, buck, nix, buckLines };
}

export function countIsolationMatches(opts: {
  snapshot: VerifyProcessSnapshot;
  parentIso: string;
  nestedIso: string;
}): { parentMatches: number; nestedMatches: number } {
  return {
    parentMatches: opts.snapshot.buckLines.filter((line) => line.includes(opts.parentIso)).length,
    nestedMatches: opts.snapshot.buckLines.filter((line) => line.includes(opts.nestedIso)).length,
  };
}

export async function sampleVerifyProcessSnapshot(
  timeoutMs = 2000,
): Promise<VerifyProcessSnapshot | null> {
  const lines = await sampleVerifyProcessLines(timeoutMs);
  return lines ? summarizeVerifyProcessSnapshot(lines) : null;
}

export async function sampleVerifyProcessLines(timeoutMs = 2000): Promise<string[] | null> {
  const lines = await processTableLines({
    psArgs: ["-axo", "pid=,ppid=,pgid=,etime=,stat=,command="],
    timeoutMs,
    pgrepPattern:
      "buck2d\\[|\\(buck2-forkserver\\)|(^|/)buck2( |$)|(^|/)node(js)?( |$)|(^|/)nix( |$)|VBR_VERIFY_LOG_FILE=|VBR_VERIFY_PROCESS_STATE_FILE=",
    pgrepToLine: (pid, cmd) => `${pid} 0 0 00:00 ? ${cmd}`,
  });
  return lines.length > 0 ? lines : null;
}

export async function appendBuck2FailureDiagnostics(opts: {
  logFile: string | null;
  passName: string;
  status: number;
  parentIso: string;
  nestedIso: string;
  threads: string;
  passCount: number;
  failCount: number;
  completionCount: number;
}) {
  if (!opts.logFile) return;
  const snapshot = await sampleVerifyProcessSnapshot().catch(() => null);
  const [load1, load5, load15] = os.loadavg();
  const lines: string[] = [
    `[verify] failure diagnostics begin pass=${opts.passName} status=${opts.status}`,
    `[verify] failure diagnostics progress pass=${opts.passCount} fail=${opts.failCount} completions=${opts.completionCount} threads=${opts.threads}`,
    `[verify] failure diagnostics load load1=${load1.toFixed(2)} load5=${load5.toFixed(2)} load15=${load15.toFixed(2)}`,
  ];
  if (!snapshot) {
    lines.push("[verify] failure diagnostics process_snapshot=unavailable");
  } else {
    const { parentMatches, nestedMatches } = countIsolationMatches({
      snapshot,
      parentIso: opts.parentIso,
      nestedIso: opts.nestedIso,
    });
    lines.push(
      `[verify] failure diagnostics processes total=${snapshot.total} node=${snapshot.node} buck=${snapshot.buck} nix=${snapshot.nix} parent_iso=${opts.parentIso} parent_matches=${parentMatches} expected_nested_iso=${opts.nestedIso} expected_nested_matches=${nestedMatches}`,
    );
    for (const line of snapshot.buckLines.slice(0, 40)) {
      lines.push(`[verify] failure diagnostics buck ${line}`);
    }
    if (snapshot.buckLines.length > 40) {
      lines.push(
        `[verify] failure diagnostics buck ... ${snapshot.buckLines.length - 40} more buck process lines`,
      );
    }
  }
  lines.push(`[verify] failure diagnostics end pass=${opts.passName}`);
  await fsp.appendFile(opts.logFile, lines.join("\n") + "\n", "utf8").catch(() => {});
}
