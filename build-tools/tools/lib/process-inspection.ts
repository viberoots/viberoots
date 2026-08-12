import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  pgrepTableResult,
  psTableResult,
  spawnOutputResult,
  type ProcessTableResult,
} from "./process-inspection-runner";
import { resolveToolPathSync } from "./tool-paths";

export type { ProcessInspectionStatus, ProcessTableResult } from "./process-inspection-runner";

export type ProcessTableOptions = {
  psArgs: string[];
  timeoutMs?: number;
  pgrepPattern?: string;
  pgrepToLine?: (pid: number, cmd: string) => string | null;
};

function splitLines(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parsePgrepLine(line: string): { pid: number; cmd: string } | null {
  const match = String(line || "")
    .trim()
    .match(/^(\d+)\s+(.*)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  const cmd = String(match[2] || "").trim();
  if (!Number.isFinite(pid) || pid <= 1 || !cmd) return null;
  if (cmd.includes("pgrep -afil")) return null;
  return { pid, cmd };
}

export function processInspectionPrefersPgrep(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VBR_CODEX_SAFEHOUSE_ACTIVE === "1" || env.VBR_CLAUDE_SAFEHOUSE_ACTIVE === "1";
}

async function spawnOutput(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return (await spawnOutputResult(cmd, args, timeoutMs)).output;
}

async function psLines(args: string[], timeoutMs: number): Promise<string[]> {
  let psPath = "";
  try {
    psPath = resolveToolPathSync("ps");
  } catch {
    return [];
  }
  return splitLines(await spawnOutput(psPath, args, timeoutMs));
}

export async function processStartSignature(pid: number, timeoutMs = 1500): Promise<string | null> {
  if (!Number.isFinite(pid) || pid <= 1) return null;
  if (processInspectionPrefersPgrep()) return null;
  const lines = await psLines(["-p", String(pid), "-o", "lstart="], timeoutMs);
  return lines[0] || null;
}

export async function processCwd(pid: number, timeoutMs = 1500): Promise<string | null> {
  if (!Number.isFinite(pid) || pid <= 1) return null;
  if (processInspectionPrefersPgrep()) return null;
  let lsofPath = "";
  try {
    lsofPath = resolveToolPathSync("lsof");
  } catch {
    return null;
  }
  const lines = splitLines(
    await spawnOutput(lsofPath, ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], timeoutMs),
  );
  for (const line of lines) {
    if (line.startsWith("n") && line.length > 1) return line.slice(1);
  }
  return null;
}

export async function pgrepProcessLines(
  pattern: string,
  timeoutMs = 2000,
): Promise<Array<{ pid: number; cmd: string }>> {
  let pgrepPath = "";
  try {
    pgrepPath = resolveToolPathSync("pgrep");
  } catch {
    return [];
  }
  return splitLines(await spawnOutput(pgrepPath, ["-afil", pattern], timeoutMs)).flatMap((line) => {
    const parsed = parsePgrepLine(line);
    return parsed ? [parsed] : [];
  });
}

export function pgrepProcessLinesSync(pattern: string): Array<{ pid: number; cmd: string }> {
  let pgrepPath = "";
  try {
    pgrepPath = resolveToolPathSync("pgrep");
  } catch {
    return [];
  }
  const out = spawnSync(pgrepPath, ["-afil", pattern], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (out.status !== 0 && !out.stdout) return [];
  return splitLines(String(out.stdout || "")).flatMap((line) => {
    const parsed = parsePgrepLine(line);
    return parsed ? [parsed] : [];
  });
}

function pgrepTableLinesSync(
  pattern: string,
  toLine: (pid: number, cmd: string) => string | null,
): string[] {
  return pgrepProcessLinesSync(pattern).flatMap(({ pid, cmd }) => {
    const line = toLine(pid, cmd);
    return line ? [line] : [];
  });
}

function uniqueLines(lines: string[]): string[] {
  return Array.from(new Set(lines));
}

async function pgrepTableLines(
  pattern: string,
  timeoutMs: number,
  toLine: (pid: number, cmd: string) => string | null,
): Promise<string[]> {
  const fallback = await pgrepProcessLines(pattern, timeoutMs);
  return fallback.flatMap(({ pid, cmd }) => {
    const line = toLine(pid, cmd);
    return line ? [line] : [];
  });
}

export function processCommandLinesSync(opts?: { pgrepPattern?: string }): string[] {
  if (opts?.pgrepPattern && processInspectionPrefersPgrep()) {
    return pgrepTableLinesSync(opts.pgrepPattern, (_pid, cmd) => cmd);
  }
  let psPath = "";
  try {
    psPath = resolveToolPathSync("ps");
  } catch {
    psPath = "";
  }
  if (psPath) {
    const out = spawnSync(psPath, ["-A", "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = splitLines(String(out.stdout || ""));
    if (lines.length > 0) return lines;
  }
  if (!opts?.pgrepPattern) return [];
  return pgrepProcessLinesSync(opts.pgrepPattern).map((p) => p.cmd);
}

export async function processTableLines(opts: ProcessTableOptions): Promise<string[]> {
  return (await processTableLinesDetailed(opts)).lines;
}

export async function processTableLinesDetailed(
  opts: ProcessTableOptions,
): Promise<ProcessTableResult> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const toLine = opts.pgrepToLine || ((pid: number, cmd: string) => `${pid} ${cmd}`);
  if (opts.pgrepPattern && processInspectionPrefersPgrep()) {
    return await pgrepTableResult(opts.pgrepPattern, timeoutMs, toLine);
  }
  const primary = await psTableResult(opts.psArgs, timeoutMs);
  if (primary.lines.length > 0) return primary;
  if (!opts.pgrepPattern) return primary;
  const fallback = await pgrepTableResult(opts.pgrepPattern, timeoutMs, toLine);
  if (fallback.lines.length > 0) return fallback;
  if (primary.status === "timeout" || fallback.status === "timeout") {
    return { lines: [], status: "timeout" };
  }
  if (primary.status === "error" || fallback.status === "error") {
    return { lines: [], status: "error" };
  }
  return { lines: [], status: "unavailable" };
}

export async function processCommandLines(opts?: {
  timeoutMs?: number;
  pgrepPattern?: string;
}): Promise<string[]> {
  const lines = await processTableLines({
    psArgs: ["-A", "-o", "command="],
    timeoutMs: opts?.timeoutMs,
    pgrepPattern: opts?.pgrepPattern,
    pgrepToLine: (_pid, cmd) => cmd,
  });
  return lines;
}

export async function buckProcessTableLines(timeoutMs = 2000): Promise<string[]> {
  const pattern = "buck2d\\[|\\(buck2-forkserver\\)";
  const toLine = (pid: number, cmd: string) => {
    if (!cmd.includes("buck2d[") && !cmd.includes("(buck2-forkserver)")) return null;
    return `${pid} 0 00:00 ${cmd}`;
  };
  if (processInspectionPrefersPgrep()) {
    return await pgrepTableLines(pattern, timeoutMs, toLine);
  }
  const psOutput = await psLines(["-A", "-ww", "-o", "pid=,ppid=,etime=,command="], timeoutMs);
  const pgrepOutput = await pgrepTableLines(pattern, timeoutMs, toLine);
  return uniqueLines([...psOutput, ...pgrepOutput]);
}

export async function buckProcessCommandLines(timeoutMs = 2000): Promise<string[]> {
  return await processCommandLines({
    timeoutMs,
    pgrepPattern: "buck2d\\[|\\(buck2-forkserver\\)|(^|/)buck2( |$)",
  });
}
