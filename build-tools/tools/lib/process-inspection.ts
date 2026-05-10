import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { resolveToolPathSync } from "./tool-paths";

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
  return await new Promise<string>((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve("");
      return;
    }
    let settled = false;
    let buf = "";
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += String(chunk || "");
    });
    child.on("error", () => finish(""));
    child.on("close", () => finish(buf));
    const timer = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish("");
      },
      Math.max(250, timeoutMs),
    );
    child.on("close", () => clearTimeout(timer));
  });
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
  const timeoutMs = opts.timeoutMs ?? 2000;
  const toLine = opts.pgrepToLine || ((pid: number, cmd: string) => `${pid} ${cmd}`);
  if (opts.pgrepPattern && processInspectionPrefersPgrep()) {
    return await pgrepTableLines(opts.pgrepPattern, timeoutMs, toLine);
  }
  const lines = await psLines(opts.psArgs, timeoutMs);
  if (lines.length > 0) return lines;
  if (!opts.pgrepPattern) return [];
  return await pgrepTableLines(opts.pgrepPattern, timeoutMs, toLine);
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
