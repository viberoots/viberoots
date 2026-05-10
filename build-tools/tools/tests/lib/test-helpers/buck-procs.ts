import "./worker-init";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pgrepProcessLines, processTableLines } from "../../../lib/process-inspection";
import { resolveToolPath } from "../../../lib/tool-paths";

type ProcessListDeps = {
  psLines?: (args: string[]) => Promise<{ exitCode: number; lines: string[] }>;
  pgrepLines?: (pattern: string) => Promise<string[]>;
};

export async function buckIsolationDirsForRepo(repoRoot: string): Promise<string[]> {
  const dirs: string[] = [];
  try {
    const buckOut = path.join(repoRoot, "buck-out");
    const ents = await fsp.readdir(buckOut, { withFileTypes: true });
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (!name) continue;
      if (name === "tmp") continue;
      dirs.push(name);
    }
  } catch {}
  if (!dirs.includes("v2")) dirs.unshift("v2");
  const envIso = String(process.env.BUCK_ISOLATION_DIR || "").trim();
  if (envIso && !dirs.includes(envIso)) dirs.unshift(envIso);
  return Array.from(new Set(dirs)).filter(Boolean);
}

function repoRootCandidatePaths(repoRoot: string): string[] {
  const abs0 = path.resolve(repoRoot);
  const absCandidates = [abs0];
  if (abs0.startsWith("/var/")) absCandidates.push(path.resolve("/private" + abs0));
  if (abs0.startsWith("/tmp/")) absCandidates.push(path.resolve("/private" + abs0));
  return absCandidates;
}

export async function forkserversUnderRepo(
  repoRoot: string,
  $: any,
  deps: ProcessListDeps = {},
): Promise<Array<{ pid: number; ppid: number; cmd: string }>> {
  const res = await psCommandLines($, ["-A", "-o", "pid=,ppid=,command="], deps);
  const lines = res.lines;
  const parsed = parseForkserverLinesForRepo(repoRoot, lines);
  if (parsed.length > 0 || res.exitCode === 0) return parsed;
  return await pgrepForkserversUnderRepo(repoRoot, deps);
}

function parseForkserverLinesForRepo(
  repoRoot: string,
  lines: string[],
): Array<{ pid: number; ppid: number; cmd: string }> {
  const absCandidates = repoRootCandidatePaths(repoRoot);
  return lines
    .map((l) => {
      const m = l.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] || "" } : null;
    })
    .filter((x): x is { pid: number; ppid: number; cmd: string } => !!x && x.pid > 1)
    .filter((p) => p.cmd.includes("(buck2-forkserver)") && p.cmd.includes("--state-dir"))
    .filter((p) => {
      const sm = p.cmd.match(/--state-dir\s+([^\s]+)/);
      const stateDirRaw = sm && sm[1] ? String(sm[1]).trim() : "";
      if (!stateDirRaw) return false;
      const stateDir = path.resolve(stateDirRaw);
      return absCandidates.some((c) => stateDir === c || stateDir.startsWith(c + path.sep));
    });
}

export async function pidCmdline(pid: number, $: any): Promise<string> {
  if (!Number.isFinite(pid) || pid <= 1) return "";
  const psPath = await resolveToolPath("ps");
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 1500,
  })`${psPath} -p ${pid} -o command=`;
  return String(res.stdout || "").trim();
}

export type Buck2dProc = { pid: number; iso: string; cmd: string };

export function isolationDirFromCmd(cmd: string): string {
  const m = String(cmd || "").match(/--isolation-dir\s+([^\s]+)/);
  return m && m[1] ? String(m[1]).trim() : "";
}

export async function buck2dProcsForRepo(
  repoRoot: string,
  $: any,
  deps: ProcessListDeps = {},
): Promise<Buck2dProc[]> {
  const base = path.basename(path.resolve(repoRoot));
  if (!base) return [];
  const res = await psCommandLines($, ["-A", "-o", "pid=,command="], deps);
  const lines = res.lines;
  const parsed = parseBuck2dLinesForRepo(base, lines);
  if (parsed.length > 0 || res.exitCode === 0) return parsed;
  return await pgrepBuck2dProcsForRepo(base, deps);
}

async function psCommandLines(
  $: any,
  args: string[],
  deps: ProcessListDeps,
): Promise<{ exitCode: number; lines: string[] }> {
  if (deps.psLines) return await deps.psLines(args);
  void $;
  const lines = await processTableLines({
    psArgs: args,
    timeoutMs: 2000,
  });
  return { exitCode: lines.length > 0 ? 0 : 1, lines };
}

function parseBuck2dLinesForRepo(base: string, lines: string[]): Buck2dProc[] {
  const out: Buck2dProc[] = [];
  for (const l of lines) {
    const m = l.match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[2] || "";
    if (!Number.isFinite(pid) || pid <= 1) continue;
    if (!cmd.includes(`buck2d[${base}]`)) continue;
    const iso = isolationDirFromCmd(cmd);
    out.push({ pid, iso, cmd });
  }
  return out;
}

function normalizePgrepLines(lines: string[]): string[] {
  return lines.flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) return [];
    const pid = Number(match[1]);
    const cmd = String(match[2] || "").trim();
    if (!Number.isFinite(pid) || pid <= 1) return [];
    if (cmd.includes("pgrep -afil")) return [];
    return [`${pid} 0 ${cmd}`];
  });
}

async function pgrepLines(pattern: string, deps: ProcessListDeps = {}): Promise<string[]> {
  if (deps.pgrepLines) return normalizePgrepLines(await deps.pgrepLines(pattern));
  return (await pgrepProcessLines(pattern, 2000)).map(({ pid, cmd }) => `${pid} 0 ${cmd}`);
}

async function pgrepForkserversUnderRepo(
  repoRoot: string,
  deps: ProcessListDeps = {},
): Promise<Array<{ pid: number; ppid: number; cmd: string }>> {
  const lines = await pgrepLines("\\(buck2-forkserver\\)", deps);
  return parseForkserverLinesForRepo(repoRoot, lines);
}

async function pgrepBuck2dProcsForRepo(
  base: string,
  deps: ProcessListDeps = {},
): Promise<Buck2dProc[]> {
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = await pgrepLines(`buck2d\\[${escapedBase}\\]`, deps);
  return parseBuck2dLinesForRepo(base, lines);
}
