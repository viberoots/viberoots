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
import { cleanupTempRepoProcesses } from "./temp-repo-process-cleanup";

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

type BuckDaemonProc = { pid: number; ppid: number; etime: string; cmd: string; iso: string };

function parseBuckDaemons(lines: string[]): BuckDaemonProc[] {
  const daemons: BuckDaemonProc[] = [];
  for (const ln of lines) {
    if (!ln.includes("buck2d[")) continue;
    const base = parsePsLine(ln);
    if (!base) continue;
    const im = base.cmd.match(/--isolation-dir\s+([^\s]+)/);
    const iso = im && im[1] ? String(im[1]).trim() : "";
    if (!iso) continue;
    daemons.push({ ...base, iso });
  }
  return daemons;
}

function etimeToSeconds(etime: string): number {
  const raw = String(etime || "").trim();
  if (!raw) return 0;
  const dm = raw.match(/^(\d+)-(.+)$/);
  const days = dm ? Number(dm[1]) : 0;
  const clock = dm ? dm[2] : raw;
  const parts = clock
    .split(":")
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return days * 86400 + h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return days * 86400 + m * 60 + s;
  }
  return days * 86400;
}

export function isLikelyEphemeralIsolation(iso: string): boolean {
  const s = String(iso || "").trim();
  if (!s) return false;
  if (/^v-\d+-\d+$/.test(s)) return true;
  if (/^verify-nested-(?:\d+-)?[a-f0-9]{12}$/.test(s)) return true;
  if (/^debug-[A-Za-z0-9._-]+-\d{9,}$/.test(s)) return true;
  if (/^targeted-[A-Za-z0-9._-]+-\d{9,}$/.test(s)) return true;
  if (/^(parity_|sanitize_|importer_strings_)/.test(s)) return true;
  return false;
}

export async function cleanupOrphanBuckDaemons(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 50);
  const staleGraceSec = Math.max(
    0,
    Number.parseInt(String(process.env.BNX_BUCK_ORPHAN_STALE_GRACE_SECS || "120"), 10) || 120,
  );
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
    if (repoOk) continue;
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

  const daemons = parseBuckDaemons(lines);
  for (const d of daemons) {
    const orphan = d.ppid <= 1 || !isPidAlive(d.ppid);
    if (!orphan) continue;
    if (!isLikelyEphemeralIsolation(d.iso)) continue;
    if (etimeToSeconds(d.etime) < staleGraceSec) continue;
    candidates++;
    if (killed >= maxKills) continue;
    if (!isPidAlive(d.pid)) continue;
    try {
      process.kill(d.pid, "SIGKILL");
    } catch {}
    killed++;
    if (opts.log) {
      await opts.log(
        `[verify] buck2 orphan cleanup: killed daemon pid=${d.pid} ppid=${d.ppid} etime=${d.etime} iso=${d.iso}`,
      );
    }
  }
  return { scanned: forks.length + daemons.length, candidates, killed };
}

export async function cleanupRegisteredTempRepos(opts: {
  stateFile: string;
  log?: (line: string) => Promise<void>;
  maxKills?: number;
  removeRoots?: boolean;
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

  let forks = parseForkservers(await psLines(2000));
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
  const procRes = await cleanupTempRepoProcesses({
    roots: uniqueRoots,
    log: opts.log,
    maxKills: maxKills * 2,
  });
  killed += procRes.killed;
  if (opts.removeRoots) {
    for (const root of uniqueRoots) {
      await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  }
  return { roots: uniqueRoots.length, killed };
}
