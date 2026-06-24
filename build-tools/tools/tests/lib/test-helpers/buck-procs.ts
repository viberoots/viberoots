import "./worker-init";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pgrepProcessLines, processTableLines } from "../../../lib/process-inspection";
import { resolveToolPath } from "../../../lib/tool-paths";
import { cwdIsInsideTempRepo } from "../buck-daemon-reaper-utils";

type ProcessListDeps = {
  psLines?: (args: string[]) => Promise<{ exitCode: number; lines: string[] }>;
  pgrepLines?: (pattern: string) => Promise<string[]>;
  cwdForPid?: (pid: number) => Promise<string>;
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

type ParsedProcLine = { pid: number; ppid: number; cmd: string };

function parseProcLine(line: string): ParsedProcLine | null {
  const twoColumn = line.match(/^(\d+)\s+(.*)$/);
  if (!twoColumn) return null;
  const pid = Number(twoColumn[1]);
  if (!Number.isFinite(pid) || pid <= 1) return null;
  const rest = twoColumn[2] || "";
  const withPpid = rest.match(/^(\d+)\s+(.*)$/);
  if (withPpid) {
    return { pid, ppid: Number(withPpid[1]) || 0, cmd: withPpid[2] || "" };
  }
  return { pid, ppid: 0, cmd: rest };
}

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
  const res = await psCommandLines($, ["-A", "-o", "pid=,ppid=,command="], deps);
  const lines = res.lines;
  const forkserverParentPids = new Set(
    parseForkserverLinesForRepo(repoRoot, lines).map((p) => p.ppid),
  );
  const parsed = await parseBuck2dLinesForRepo(
    repoRoot,
    base,
    lines,
    forkserverParentPids,
    $,
    deps,
  );
  if (parsed.length > 0 || res.exitCode === 0) return parsed;
  return await pgrepBuck2dProcsForRepo(repoRoot, base, deps);
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

async function cwdForPid(pid: number, $: any, deps: ProcessListDeps): Promise<string> {
  if (deps.cwdForPid) return await deps.cwdForPid(pid);
  const lsofPath = await resolveToolPath("lsof").catch(() => "");
  if (!lsofPath) return "";
  if (typeof $ !== "function") {
    const stdout = await new Promise<string>((resolve) => {
      let child;
      try {
        child = spawn(lsofPath, ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
          stdio: ["ignore", "pipe", "ignore"],
        });
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
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish("");
      }, 1500);
      child.on("close", () => clearTimeout(timer));
    });
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith("n"));
    return line ? line.slice(1).trim() : "";
  }
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 1500,
  })`${lsofPath} -a -p ${pid} -d cwd -Fn`;
  const line = String(res.stdout || "")
    .split(/\r?\n/)
    .find((l) => l.startsWith("n"));
  return line ? line.slice(1).trim() : "";
}

async function parseBuck2dLinesForRepo(
  repoRoot: string,
  base: string,
  lines: string[],
  forkserverParentPids: ReadonlySet<number>,
  $: any,
  deps: ProcessListDeps,
): Promise<Buck2dProc[]> {
  const out: Buck2dProc[] = [];
  for (const l of lines) {
    const parsed = parseProcLine(l);
    if (!parsed) continue;
    const { pid, cmd } = parsed;
    if (!cmd.includes("buck2d[")) continue;
    const directNameMatch = cmd.includes(`buck2d[${base}]`);
    const nestedForkserverParent = forkserverParentPids.has(pid);
    if (!directNameMatch && !nestedForkserverParent) continue;
    const cwd = await cwdForPid(pid, $, deps);
    if (!cwdIsInsideTempRepo(cwd, repoRoot)) continue;
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
  repoRoot: string,
  base: string,
  deps: ProcessListDeps = {},
): Promise<Buck2dProc[]> {
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = await pgrepLines(`buck2d\\[${escapedBase}\\]`, deps);
  return await parseBuck2dLinesForRepo(repoRoot, base, lines, new Set(), undefined, deps);
}
