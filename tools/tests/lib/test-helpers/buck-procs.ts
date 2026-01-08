import "./worker-init";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
): Promise<Array<{ pid: number; ppid: number; cmd: string }>> {
  const absCandidates = repoRootCandidatePaths(repoRoot);
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 2000,
  })`/bin/ps -A -o pid=,ppid=,command=`;
  const lines = String(res.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
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
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 1500,
  })`/bin/ps -p ${pid} -o command=`;
  return String(res.stdout || "").trim();
}

export type Buck2dProc = { pid: number; iso: string; cmd: string };

export function isolationDirFromCmd(cmd: string): string {
  const m = String(cmd || "").match(/--isolation-dir\s+([^\s]+)/);
  return m && m[1] ? String(m[1]).trim() : "";
}

export async function buck2dProcsForRepo(repoRoot: string, $: any): Promise<Buck2dProc[]> {
  const base = path.basename(path.resolve(repoRoot));
  if (!base) return [];
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 2000,
  })`/bin/ps -A -o pid=,command=`;
  const lines = String(res.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
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
