import "./worker-init";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buck2dProcsForRepo,
  buckIsolationDirsForRepo,
  forkserversUnderRepo,
  isolationDirFromCmd,
  pidCmdline,
} from "./buck-procs";

const BUCK_KILL_TIMEOUT_MS = 5000;
const BUCK_FORKSERVER_REAP_DEADLINE_MS = 60000;
const BUCK_FORKSERVER_REAP_POLL_MS = 250;
const BUCK_FORKSERVER_REAP_QUIET_MS = 1000;
const BUCK_DAEMON_CLEANUP_SETTLE_MS = 20000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isFinite(pid) || pid <= 1) return;
  try {
    process.kill(pid, signal);
  } catch {}
}

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
  let offenders = await forkserversUnderRepo(repoRoot, $);
  const isos = Array.from(
    new Set(offenders.map((o) => isoFromForkserverStateDir(repoRoot, o.cmd)).filter(Boolean)),
  );
  await Promise.allSettled(isos.map((iso) => killBuckIsolation(repoRoot, iso, $)));
  offenders = await forkserversUnderRepo(repoRoot, $);
  for (const o of offenders) {
    const iso = isoFromForkserverStateDir(repoRoot, o.cmd);
    if (iso) signalPid(o.ppid, "SIGTERM");
    signalPid(o.pid, "SIGTERM");
  }
  await sleep(250);

  let remaining = await forkserversUnderRepo(repoRoot, $);
  for (const o of remaining) {
    const iso = isoFromForkserverStateDir(repoRoot, o.cmd);
    if (iso || (await forkserverParentMatchesIsolation(o.ppid, iso, $)))
      signalPid(o.ppid, "SIGKILL");
    signalPid(o.pid, "SIGKILL");
  }
  await sleep(250);

  remaining = await forkserversUnderRepo(repoRoot, $);
  for (const o of remaining) {
    const iso = isoFromForkserverStateDir(repoRoot, o.cmd);
    if (iso || (await forkserverParentMatchesIsolation(o.ppid, iso, $)))
      signalPid(o.ppid, "SIGKILL");
    signalPid(o.pid, "SIGKILL");
  }
}

async function killBuckIsolation(repoRoot: string, iso: string, $: any): Promise<void> {
  if (!repoRoot || !iso) return;
  await $({
    stdio: "ignore",
    cwd: repoRoot,
    reject: false,
    nothrow: true,
    timeout: BUCK_KILL_TIMEOUT_MS,
    // lint: allow-hardcoded-buck-isolation: cleanup kills the isolation proven by forkserver state-dir
  })`buck2 --isolation-dir ${iso} kill`;
}

async function forkserverParentMatchesIsolation(
  ppid: number,
  iso: string,
  $: any,
): Promise<boolean> {
  if (!iso || !Number.isFinite(ppid) || ppid <= 1) return false;
  const cmd = await pidCmdline(ppid, $);
  return cmd.includes("buck2d[") && isolationDirFromCmd(cmd) === iso;
}

async function reapBuckForkserversUnderRepo(repoRoot: string, $: any): Promise<void> {
  const deadline = Date.now() + BUCK_FORKSERVER_REAP_DEADLINE_MS;
  let quietSince: number | undefined;
  while (Date.now() < deadline) {
    const offenders = await forkserversUnderRepo(repoRoot, $);
    if (offenders.length > 0) {
      quietSince = undefined;
      await killBuckForkserversUnderRepo(repoRoot, $);
      await sleep(BUCK_FORKSERVER_REAP_POLL_MS);
      continue;
    }
    quietSince ??= Date.now();
    if (Date.now() - quietSince >= BUCK_FORKSERVER_REAP_QUIET_MS) return;
    await sleep(BUCK_FORKSERVER_REAP_POLL_MS);
  }
  await assertNoBuckForkserversUnderRepo(repoRoot, $);
}

async function nestedBuckRepoRoots(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set([path.resolve(repoRoot)]);
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth <= 0) return;
    let ents: Array<fsp.Dirent>;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      if ([".git", ".viberoots", "buck-out", "node_modules"].includes(ent.name)) continue;
      const child = path.join(dir, ent.name);
      const resolved = path.resolve(child);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const hasBuckOut = await fsp
        .access(path.join(child, "buck-out"))
        .then(() => true)
        .catch(() => false);
      if (hasBuckOut) out.push(child);
      await visit(child, depth - 1);
    }
  }
  await visit(repoRoot, 3);
  return out;
}

export async function buckCleanupRootsForRepo(repoRoot: string): Promise<string[]> {
  return [repoRoot, ...(await nestedBuckRepoRoots(repoRoot))];
}

async function killBuckDaemonsForSingleRepo(repoRoot: string, $: any): Promise<void> {
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
    for (const p of procs) signalPid(p.pid, "SIGTERM");
    await sleep(250);
    for (const p of procs) signalPid(p.pid, "SIGKILL");
    await reapBuckForkserversUnderRepo(repoRoot, $);
    return;
  }
  const procs = await buck2dProcsForRepo(repoRoot, $);
  const procIsos = new Set(procs.map((p) => p.iso).filter(Boolean));
  const isoDirs = await buckIsolationDirsForRepo(repoRoot);
  const want = new Set([...isoDirs, ...procIsos].filter(Boolean));
  if (want.size > 0 && procIsos.size > 0) {
    await Promise.allSettled(
      Array.from(procIsos).map(
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
      signalPid(p.pid, "SIGTERM");
    }
    await sleep(250);
    for (const p of procs) {
      if (!p.iso || !want.has(p.iso)) continue;
      signalPid(p.pid, "SIGKILL");
    }
  }
  await reapBuckForkserversUnderRepo(repoRoot, $);
}

export async function killBuckDaemonsForRepo(repoRoot: string, $: any): Promise<void> {
  const roots = await buckCleanupRootsForRepo(repoRoot);
  await killBuckDaemonsForRoots(roots, $);
}

export async function killBuckDaemonsForRoots(roots: string[], $: any): Promise<void> {
  const deadline = Date.now() + BUCK_DAEMON_CLEANUP_SETTLE_MS;
  while (true) {
    for (const root of roots) {
      await killBuckDaemonsForSingleRepo(root, $);
    }
    const remaining = (
      await Promise.all(roots.map(async (root) => await buck2dProcsForRepo(root, $)))
    ).flat();
    if (remaining.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `buck cleanup: leaked buck2d under temp repo root:\n${remaining
          .slice(0, 20)
          .map((p) => `${p.pid} ${p.iso || ""} ${p.cmd}`)
          .join("\n")}`,
      );
    }
    await sleep(250);
  }
}
