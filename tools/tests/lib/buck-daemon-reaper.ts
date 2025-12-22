#!/usr/bin/env zx-wrapper
import path from "node:path";
import { cwdIsInsideTempRepo } from "./buck-daemon-reaper-utils.ts";

type Args = {
  parent?: string;
  tmp?: string;
  stateFile?: string;
  pollMs?: string;
};

function parseArg(name: string, def: string = ""): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1] || def;
  return def;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processStartSignature(pid: number): Promise<string> {
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`/bin/ps -p ${pid} -o lstart=`;
  return String(res.stdout || "").trim();
}

async function tempRepoStillExists(tmpRepoRoot: string): Promise<boolean> {
  try {
    await (await import("node:fs/promises")).access(tmpRepoRoot);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function readBuck2dProcesses(): Promise<Array<{ pid: number; cmd: string }>> {
  const { stdout } = await $({ stdio: "pipe" })`/bin/ps -A -o pid=,command=`;
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: Array<{ pid: number; cmd: string }> = [];
  for (const ln of lines) {
    if (!ln.includes("buck2d[")) continue;
    const m = ln.match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    out.push({ pid: Number(m[1]), cmd: m[2] || "" });
  }
  return out;
}

async function cwdForPid(pid: number): Promise<string> {
  // Use lsof to read cwd, which is reliable on macOS for same-user processes.
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`lsof -a -p ${pid} -d cwd -Fn`;
  const out = String(res.stdout || "");
  // Format includes lines like:
  // p<PID>\nfcwd\nn<path>\n
  const m = out.match(/\n(?:n)([^\n]+)\n/);
  return m && m[1] ? String(m[1]).trim() : "";
}

function isolationDirFromCmd(cmd: string): string {
  const m = String(cmd || "").match(/--isolation-dir\s+([^\s]+)/);
  return m && m[1] ? String(m[1]).trim() : "";
}

async function killBuckIsoInRepo(tmpRepoRoot: string, iso: string): Promise<void> {
  if (!tmpRepoRoot || !iso) return;
  await $({
    cwd: tmpRepoRoot,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 --isolation-dir ${iso} kill`;
}

async function reapBuckDaemonsForTempRepo(tmpRepoRoot: string): Promise<void> {
  const procs = await readBuck2dProcesses();
  for (const p of procs) {
    const iso = isolationDirFromCmd(p.cmd);
    if (!iso) continue;
    const cwd = await cwdForPid(p.pid);
    if (!cwdIsInsideTempRepo(cwd, tmpRepoRoot)) continue;
    await killBuckIsoInRepo(tmpRepoRoot, iso);
  }
}

async function main() {
  const argv = (global as any).argv as Args;
  const parentPidRaw = argv?.parent || parseArg("parent", "");
  const tmp = argv?.tmp || parseArg("tmp", "");
  const stateFile = argv?.stateFile || parseArg("state-file", "");
  const pollMsRaw = argv?.pollMs || parseArg("poll-ms", "1000");

  const tmpRepoRoot = tmp ? path.resolve(tmp) : "";
  const parentPid = Number(parentPidRaw);
  const pollMs = Math.max(250, Number(pollMsRaw) || 1000);

  if (!Number.isFinite(parentPid) || parentPid <= 1) return;
  if (!tmpRepoRoot && !stateFile) return;

  const initialSig = await processStartSignature(parentPid).catch(() => "");
  const maxWaitMs = 30 * 60 * 1000; // fail-safe: do not run forever
  const t0 = Date.now();

  // Wait for parent to exit (covers normal exit and abrupt termination).
  while (isPidAlive(parentPid)) {
    if (Date.now() - t0 > maxWaitMs) return;
    if (tmpRepoRoot && !(await tempRepoStillExists(tmpRepoRoot))) return;
    const curSig = await processStartSignature(parentPid).catch(() => "");
    if (initialSig && curSig && curSig !== initialSig) break; // pid reused; original parent is gone
    await sleep(pollMs);
  }

  // Parent exited: reap only buck2d daemons whose cwd lives under registered temp repos.
  const tmpRoots: string[] = [];
  if (tmpRepoRoot) tmpRoots.push(tmpRepoRoot);
  if (stateFile) {
    try {
      const txt = await (await import("node:fs/promises")).readFile(stateFile, "utf8");
      for (const ln of String(txt || "").split(/\r?\n/)) {
        const p = ln.trim();
        if (p) tmpRoots.push(p);
      }
    } catch {}
  }
  const seen = new Set<string>();
  for (const r of tmpRoots) {
    const abs = path.resolve(r);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!(await tempRepoStillExists(abs))) continue;
    await reapBuckDaemonsForTempRepo(abs);
  }
}

main().catch(() => process.exit(0));
