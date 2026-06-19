import "./worker-init";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buck2dProcsForRepo, buckIsolationDirsForRepo, forkserversUnderRepo } from "./buck-procs";

const BUCK_KILL_TIMEOUT_MS = 5000;
const BUCK_FORKSERVER_REAP_DEADLINE_MS = 20000;

async function assertNoBuckForkserversUnderRepo(repoRoot: string, $: any): Promise<void> {
  const offenders = await forkserversUnderRepo(repoRoot, $);
  if (offenders.length > 0) {
    throw new Error(
      `buck cleanup: leaked buck2-forkserver under temp repo root:\n${offenders
        .slice(0, 20)
        .map((o) => `${o.pid} ${o.ppid} ${o.cmd}`)
        .join("\n")}`,
    );
  }
}

function isoFromForkserverStateDir(repoRoot: string, forkserverCmd: string): string {
  const sm = String(forkserverCmd || "").match(/--state-dir\s+([^\s]+)/);
  const stateDirRaw = sm && sm[1] ? String(sm[1]).trim() : "";
  if (!stateDirRaw) return "";
  const root0 = path.resolve(repoRoot);
  const roots = [root0];
  if (root0.startsWith("/var/")) roots.push(path.resolve("/private" + root0));
  if (root0.startsWith("/tmp/")) roots.push(path.resolve("/private" + root0));
  const stateDir = path.resolve(stateDirRaw);
  let matched = "";
  for (const r of roots) {
    if (stateDir === r || stateDir.startsWith(r + path.sep)) {
      matched = r;
      break;
    }
  }
  if (!matched) return "";
  try {
    const rel = path.relative(matched, stateDir);
    const parts = rel.split(path.sep).filter(Boolean);
    const idx = parts.indexOf("buck-out");
    if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1] || "";
  } catch {}
  return "";
}

async function killBuckForkserversUnderRepo(repoRoot: string, $: any): Promise<void> {
  const offenders = await forkserversUnderRepo(repoRoot, $);
  for (const o of offenders) {
    const iso = isoFromForkserverStateDir(repoRoot, o.cmd);
    if (iso && o.ppid > 1) {
      try {
        process.kill(o.ppid, "SIGTERM");
      } catch {}
    }
    try {
      if (o.pid > 1) process.kill(o.pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 250));
  for (const o of offenders) {
    if (o.ppid > 1) {
      try {
        process.kill(o.ppid, "SIGKILL");
      } catch {}
    }
    try {
      if (o.pid > 1) process.kill(o.pid, "SIGKILL");
    } catch {}
  }
}

async function reapBuckForkserversUnderRepo(repoRoot: string, $: any): Promise<void> {
  const deadline = Date.now() + BUCK_FORKSERVER_REAP_DEADLINE_MS;
  let offenders = await forkserversUnderRepo(repoRoot, $);
  while (offenders.length > 0 && Date.now() < deadline) {
    await killBuckForkserversUnderRepo(repoRoot, $);
    await new Promise((r) => setTimeout(r, 250));
    offenders = await forkserversUnderRepo(repoRoot, $);
  }
  await assertNoBuckForkserversUnderRepo(repoRoot, $);
}

export async function killBuckDaemonsForRepo(repoRoot: string, $: any): Promise<void> {
  const buckOut = path.join(repoRoot, "buck-out");
  const buckOutExists = await fsp
    .access(buckOut)
    .then(() => true)
    .catch(() => false);
  if (!buckOutExists) {
    // Fast path with hardening: skip full cleanup scans when repo buck-out was removed,
    // but still reap any forkservers/daemons that are provably scoped to this exact temp repo.
    const [forks, procs] = await Promise.all([
      forkserversUnderRepo(repoRoot, $),
      buck2dProcsForRepo(repoRoot, $),
    ]);
    if (forks.length === 0 && procs.length === 0) return;
    for (const p of procs) {
      try {
        process.kill(p.pid, "SIGTERM");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 150));
    for (const p of procs) {
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {}
    }
    await reapBuckForkserversUnderRepo(repoRoot, $);
    return;
  }
  const procs = await buck2dProcsForRepo(repoRoot, $);
  const procIsos = new Set(procs.map((p) => p.iso).filter(Boolean));
  const isoDirs = await buckIsolationDirsForRepo(repoRoot);
  const want = new Set([...isoDirs, ...procIsos].filter(Boolean));
  if (want.size > 0 && procIsos.size > 0) {
    // Keep cleanup bounded: serial 10s buck2 kill calls can dominate test wall time
    // when many temporary isolations are present in a single temp repo.
    const killIsos = Array.from(procIsos);
    await Promise.allSettled(
      killIsos.map(
        (iso) =>
          $({
            stdio: "ignore",
            cwd: repoRoot,
            reject: false,
            nothrow: true,
            timeout: BUCK_KILL_TIMEOUT_MS,
            // lint: allow-hardcoded-buck-isolation: cleanup must kill each discovered temp daemon
          })`buck2 --isolation-dir ${iso} kill`,
      ),
    );
  }
  if (want.size > 0 && procs.length > 0) {
    for (const p of procs) {
      if (!p.iso || !want.has(p.iso)) continue;
      try {
        process.kill(p.pid, "SIGTERM");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
    for (const p of procs) {
      if (!p.iso || !want.has(p.iso)) continue;
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {}
    }
  }
  await reapBuckForkserversUnderRepo(repoRoot, $);
}
