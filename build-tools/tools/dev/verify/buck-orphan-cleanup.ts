import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  buck2Kill,
  isPidAlive,
  isTempRepoRoot,
  listIsolationDirs,
  parsePsLine,
  pathExists,
  psLines,
  tryRepoRootFromStateDir,
} from "./buck-orphan-cleanup-lib";
import type { ForkserverProc } from "./buck-orphan-cleanup-lib";

function parseForkservers(lines: string[]): ForkserverProc[] {
  const forks: ForkserverProc[] = [];
  for (const ln of lines) {
    if (!ln.includes("(buck2-forkserver)") || !ln.includes("--state-dir")) continue;
    const base = parsePsLine(ln);
    if (!base) continue;
    const sm = base.cmd.match(/--state-dir\s+([^\s]+)/);
    const stateDir = sm && sm[1] ? String(sm[1]).trim() : "";
    if (!stateDir) continue;
    forks.push({ ...base, stateDir });
  }
  return forks;
}

export async function cleanupOrphanBuckDaemons(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 50);
  const lines = await psLines(2000);
  const forks = parseForkservers(lines);

  let killed = 0;
  let candidates = 0;
  for (const f of forks) {
    const mapped = tryRepoRootFromStateDir(f.stateDir);
    if (!mapped) continue;
    const { repoRoot, iso } = mapped;
    if (!isTempRepoRoot(repoRoot)) continue;
    const orphan = f.ppid <= 1 || !isPidAlive(f.ppid);
    if (!orphan) continue;
    candidates++;
    if (killed >= maxKills) continue;

    const repoOk = await pathExists(repoRoot);
    // Safety: never kill processes that might belong to another *active* run.
    // Only clean up when the temp repo root has already been deleted from disk.
    // (If the repo still exists, we cannot prove the daemon is unused.)
    if (repoOk) continue;

    // Ensure processes are gone when the repo directory no longer exists.
    if (isPidAlive(f.pid)) {
      try {
        process.kill(f.pid, "SIGKILL");
      } catch {}
    }
    if (f.ppid > 1 && isPidAlive(f.ppid)) {
      try {
        process.kill(f.ppid, "SIGKILL");
      } catch {}
    }
    killed++;
    if (opts.log) {
      await opts.log(
        `[verify] buck2 orphan cleanup: killed forkserver pid=${f.pid} ppid=${f.ppid} etime=${f.etime} repo=${repoRoot} iso=${iso}`,
      );
    }
  }
  return { scanned: forks.length, candidates, killed };
}

export async function cleanupRegisteredTempRepos(opts: {
  stateFile: string;
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ roots: number; killed: number }> {
  const stateFile = String(opts.stateFile || "").trim();
  if (!stateFile) return { roots: 0, killed: 0 };
  const txt = await fsp.readFile(stateFile, "utf8").catch(() => "");
  const roots = String(txt || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p))
    // Registered roots come from this verify run's own state file; keep broad here so
    // temp dirs rooted under platform-specific $TMPDIR locations are still cleaned.
    .filter((p) => p.length > 1);
  const uniqueRoots = Array.from(new Set(roots));
  if (uniqueRoots.length === 0) return { roots: 0, killed: 0 };

  const lines = await psLines(2000);
  let forks = parseForkservers(lines);

  let killed = 0;
  const maxKills = Math.max(0, opts.maxKills ?? 200);
  for (const root of uniqueRoots) {
    if (killed >= maxKills) break;
    if (!(await pathExists(root))) continue;
    const isos = await listIsolationDirs(root);
    for (const iso of isos) {
      if (killed >= maxKills) break;
      await buck2Kill(root, iso, 5000);
    }
  }

  for (let pass = 0; pass < 3 && killed < maxKills; pass++) {
    let matchedThisPass = 0;
    for (const f of forks) {
      if (killed >= maxKills) break;
      const mapped = tryRepoRootFromStateDir(f.stateDir);
      if (!mapped) continue;
      const { repoRoot, iso } = mapped;
      const absRepo = path.resolve(repoRoot);
      if (!uniqueRoots.includes(absRepo)) continue;
      if (!(await pathExists(absRepo))) continue;
      matchedThisPass++;

      await buck2Kill(absRepo, iso, 5000);
      if (isPidAlive(f.pid)) {
        try {
          process.kill(f.pid, "SIGKILL");
        } catch {}
      }
      if (f.ppid > 1 && isPidAlive(f.ppid)) {
        try {
          process.kill(f.ppid, "SIGKILL");
        } catch {}
      }
      killed++;
      if (opts.log) {
        await opts.log(
          `[verify] temp-repo buck cleanup: killed forkserver pid=${f.pid} ppid=${f.ppid} etime=${f.etime} repo=${repoRoot} iso=${iso}`,
        );
      }
    }
    if (matchedThisPass === 0) break;
    forks = parseForkservers(await psLines(2000));
  }

  // Final fallback: if buck2 kill + forkserver sweep didn't clear daemons,
  // kill buck2d processes scoped to registered temp repo basenames.
  const lines2 = await psLines(2000);
  for (const root of uniqueRoots) {
    if (killed >= maxKills) break;
    if (!(await pathExists(root))) continue;
    const base = path.basename(path.resolve(root));
    if (!base) continue;
    const prefix = `buck2d[${base}]`;
    for (const ln of lines2) {
      if (killed >= maxKills) break;
      if (!ln.includes(prefix)) continue;
      const m = ln.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const etime = m[3] || "";
      if (!Number.isFinite(pid) || pid <= 1) continue;
      if (!isPidAlive(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
      killed++;
      if (opts.log) {
        await opts.log(
          `[verify] temp-repo buck cleanup: killed buck2d pid=${pid} etime=${etime} repo=${root}`,
        );
      }
    }
  }

  return { roots: uniqueRoots.length, killed };
}
