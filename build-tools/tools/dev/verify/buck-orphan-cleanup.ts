import {
  buck2Kill,
  isPidAlive,
  isTempRepoRoot,
  liveOwnerPidFromEphemeralIsolation,
  parsePsLine,
  pathExists,
  psLines,
  tryRepoRootFromStateDir,
} from "./buck-orphan-cleanup-lib";
import type { ForkserverProc } from "./buck-orphan-cleanup-lib";
import {
  cleanupOrphanRegisteredBuckIsolations,
  cleanupOrphanRegisteredTempRepos,
  cleanupRegisteredBuckIsolations,
  cleanupRegisteredTempRepos,
} from "./registered-buck-cleanup";
import { cleanupOrphanVerifyProcesses, etimeToSeconds } from "./verify-owned-orphan-cleanup";

export {
  cleanupOrphanRegisteredTempRepos,
  cleanupRegisteredBuckIsolations,
  cleanupRegisteredTempRepos,
};

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

export function isLikelyEphemeralIsolation(iso: string): boolean {
  const s = String(iso || "").trim();
  if (!s) return false;
  if (/^v-\d+-\d+$/.test(s)) return true;
  if (/^verify-nested-(?:\d+-)?[a-f0-9]{12}$/.test(s)) return true;
  if (/^zxtest-[A-Za-z0-9_-]+-[a-f0-9]{10}$/.test(s)) return true;
  if (/^debug-[A-Za-z0-9._-]+-\d{9,}$/.test(s)) return true;
  if (/^targeted-[A-Za-z0-9._-]+-\d{9,}$/.test(s)) return true;
  if (/^(parity_|sanitize_|importer_strings_)/.test(s)) return true;
  return false;
}

export async function cleanupOrphanBuckDaemons(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
  ignoreLiveOwnerPid?: number;
  includeOwnerlessEphemeral?: boolean;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 50);
  const includeOwnerlessEphemeral = opts.includeOwnerlessEphemeral ?? false;
  const ignoreLiveOwnerPid = opts.ignoreLiveOwnerPid ?? -1;
  const staleGraceRaw = Number.parseInt(
    String(process.env.BNX_BUCK_ORPHAN_STALE_GRACE_SECS || "120"),
    10,
  );
  const staleGraceSec = Math.max(0, Number.isFinite(staleGraceRaw) ? staleGraceRaw : 120);
  const lines = await psLines(2000);
  const forks = parseForkservers(lines);
  let killed = 0;
  let candidates = 0;
  for (const f of forks) {
    const mapped = tryRepoRootFromStateDir(f.stateDir);
    if (!mapped) continue;
    const { repoRoot, iso } = mapped;
    if (!isTempRepoRoot(repoRoot)) continue;
    if (f.ppid > 1 && isPidAlive(f.ppid)) continue;
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
  const forkserversByIso = new Map<string, ForkserverProc[]>();
  for (const fork of forks) {
    const mapped = tryRepoRootFromStateDir(fork.stateDir);
    if (!mapped) continue;
    const existing = forkserversByIso.get(mapped.iso) ?? [];
    existing.push(fork);
    forkserversByIso.set(mapped.iso, existing);
  }
  for (const d of daemons) {
    if (d.ppid > 1 && isPidAlive(d.ppid)) continue;
    if (!isLikelyEphemeralIsolation(d.iso)) continue;
    const liveOwnerPid = liveOwnerPidFromEphemeralIsolation(d.iso);
    if (liveOwnerPid && liveOwnerPid !== ignoreLiveOwnerPid) {
      if (opts.log) {
        await opts.log(
          `[verify] buck2 orphan cleanup: skipped live-owner daemon pid=${d.pid} ppid=${d.ppid} etime=${d.etime} iso=${d.iso} owner_pid=${liveOwnerPid}`,
        );
      }
      continue;
    }
    if (!liveOwnerPid && !includeOwnerlessEphemeral) continue;
    if (etimeToSeconds(d.etime) < staleGraceSec) continue;
    candidates++;
    if (killed >= maxKills) continue;
    if (!isPidAlive(d.pid)) continue;
    const matchingForkservers = forkserversByIso.get(d.iso) ?? [];
    for (const fork of matchingForkservers) {
      const mapped = tryRepoRootFromStateDir(fork.stateDir);
      if (!mapped) continue;
      if (await pathExists(mapped.repoRoot)) {
        await buck2Kill(mapped.repoRoot, mapped.iso, 5000);
      }
    }
    try {
      process.kill(d.pid, "SIGKILL");
    } catch {}
    for (const fork of matchingForkservers) {
      if (fork.ppid > 1 && isPidAlive(fork.ppid)) continue;
      if (!isPidAlive(fork.pid)) continue;
      try {
        process.kill(fork.pid, "SIGKILL");
      } catch {}
    }
    killed++;
    if (opts.log) {
      await opts.log(
        `[verify] buck2 orphan cleanup: killed daemon pid=${d.pid} ppid=${d.ppid} etime=${d.etime} iso=${d.iso}`,
      );
    }
  }
  const registeredIsoRes = await cleanupOrphanRegisteredBuckIsolations({
    log: opts.log,
    maxKills: Math.max(0, maxKills - killed),
  }).catch(() => ({ scanned: 0, candidates: 0, killed: 0 }));
  killed += registeredIsoRes.killed;
  const registeredTempRepoRes = await cleanupOrphanRegisteredTempRepos({
    log: opts.log,
    maxKills: Math.max(0, maxKills - killed),
  }).catch(() => ({ scanned: 0, candidates: 0, killed: 0 }));
  killed += registeredTempRepoRes.killed;
  const verifyProcRes = await cleanupOrphanVerifyProcesses(opts).catch(() => ({
    scanned: 0,
    candidates: 0,
    killed: 0,
  }));
  return {
    scanned:
      forks.length +
      daemons.length +
      registeredIsoRes.scanned +
      registeredTempRepoRes.scanned +
      verifyProcRes.scanned,
    candidates:
      candidates +
      registeredIsoRes.candidates +
      registeredTempRepoRes.candidates +
      verifyProcRes.candidates,
    killed: killed + verifyProcRes.killed,
  };
}
