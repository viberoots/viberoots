import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  buck2Kill,
  existingPathVariant,
  isPidAlive,
  listIsolationDirs,
  parentIsMatchingBuckDaemon,
  parsePsLine,
  pathStartsWithRootVariant,
  pathExists,
  pathsEquivalent,
  psLines,
  tryRepoRootFromStateDir,
} from "./buck-orphan-cleanup-lib";
import type { ForkserverProc } from "./buck-orphan-cleanup-lib";
import { parseVerifyOwnedState } from "./owned-process-state";
import { registeredIsolationProcessPidsFromLines } from "./registered-buck-cleanup";
import { uniqueRegisteredRoots } from "./registered-temp-repo-roots";
import { cleanupTempRepoProcesses } from "./temp-repo-process-cleanup";
import {
  listCandidateStateFiles,
  parseEnvVerifyProcesses,
  psLinesWithEnv,
} from "./verify-owned-process-scan";

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

function rootHasLiveForkserver(root: string, lines: string[]): boolean {
  const buckOut = path.join(path.resolve(root), "buck-out");
  for (const fork of parseForkservers(lines)) {
    if (pathStartsWithRootVariant(fork.stateDir, buckOut) && isPidAlive(fork.pid)) return true;
  }
  return false;
}

async function anyPathExists(paths: string[]): Promise<boolean> {
  for (const p of paths) {
    if (await pathExists(p)) return true;
  }
  return false;
}

async function pruneDefinitelyStaleRegisteredStateFiles(
  stateFiles: string[],
): Promise<{ stateFiles: string[]; pruned: number }> {
  if (stateFiles.length === 0) return { stateFiles, pruned: 0 };
  const lines = await psLines(2000);
  const envProcs = parseEnvVerifyProcesses(await psLinesWithEnv(2000));
  const kept: string[] = [];
  let pruned = 0;
  for (const stateFile of stateFiles) {
    const txt = await fsp.readFile(stateFile, "utf8").catch(() => "");
    const parsed = parseVerifyOwnedState(txt);
    const roots = parsed.roots
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => path.resolve(root))
      .filter((root) => root.length > 1);
    const uniqueRoots = Array.from(new Set(roots));
    if (uniqueRoots.length === 0) {
      kept.push(stateFile);
      continue;
    }
    const anyRootExists = await anyPathExists(uniqueRoots);
    const anyRegisteredProcessAlive = parsed.processes.some(
      (entry) => !entry.startSig.startsWith("pid:") && isPidAlive(entry.pid),
    );
    const anyVerifyEnvProcessAlive = envProcs.some(
      (entry) => path.resolve(entry.stateFile) === path.resolve(stateFile) && isPidAlive(entry.pid),
    );
    const anyRegisteredIsolationAlive = parsed.isolations.some((entry) =>
      registeredIsolationProcessPidsFromLines(entry, lines).some((pid) => isPidAlive(pid)),
    );
    const anyRootForkserverAlive = uniqueRoots.some((root) => rootHasLiveForkserver(root, lines));
    if (
      anyRootExists ||
      anyRegisteredProcessAlive ||
      anyVerifyEnvProcessAlive ||
      anyRegisteredIsolationAlive ||
      anyRootForkserverAlive
    ) {
      kept.push(stateFile);
      continue;
    }
    await fsp.rm(stateFile, { force: true }).catch(() => {});
    pruned++;
  }
  return { stateFiles: kept, pruned };
}

export async function cleanupOrphanRegisteredTempRepos(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
  maxRoots?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const listedStateFiles = await listCandidateStateFiles();
  const { stateFiles, pruned } = await pruneDefinitelyStaleRegisteredStateFiles(listedStateFiles);
  if (pruned > 0 && opts.log) {
    await opts.log(`[verify] orphan registered state cleanup: pruned=${pruned}`);
  }
  let candidates = 0;
  let killed = 0;
  const maxKills = Math.max(0, opts.maxKills ?? 200);
  let remainingRoots = Math.max(0, opts.maxRoots ?? 200);
  for (const stateFile of stateFiles) {
    if (killed >= maxKills || remainingRoots <= 0) break;
    const txt = await fsp.readFile(stateFile, "utf8").catch(() => "");
    const roots = uniqueRegisteredRoots(parseVerifyOwnedState(txt).roots);
    if (roots.length === 0) continue;
    candidates += Math.min(roots.length, remainingRoots);
    const res = await cleanupRegisteredTempRepos({
      stateFile,
      log: opts.log,
      maxKills: Math.max(0, maxKills - killed),
      maxRoots: remainingRoots,
      removeRoots: true,
    });
    killed += res.killed;
    remainingRoots -= res.roots;
    if (opts.log) {
      await opts.log(
        `[verify] orphan registered temp repo cleanup: state=${stateFile} roots=${res.roots} skipped_roots=${res.skippedRoots} killed=${res.killed}`,
      );
    }
  }
  return { scanned: listedStateFiles.length, candidates, killed };
}

export async function cleanupRegisteredTempRepos(opts: {
  stateFile: string;
  log?: (line: string) => Promise<void>;
  maxKills?: number;
  maxRoots?: number;
  removeRoots?: boolean;
}): Promise<{ roots: number; killed: number; skippedRoots: number }> {
  const stateFile = String(opts.stateFile || "").trim();
  if (!stateFile) return { roots: 0, killed: 0, skippedRoots: 0 };
  const txt = await fsp.readFile(stateFile, "utf8").catch(() => "");
  const allRoots = uniqueRegisteredRoots(parseVerifyOwnedState(txt).roots);
  if (allRoots.length === 0) return { roots: 0, killed: 0, skippedRoots: 0 };
  const maxRoots = Math.max(0, opts.maxRoots ?? allRoots.length);
  const uniqueRoots = allRoots.slice(0, maxRoots);
  if (uniqueRoots.length === 0) {
    return { roots: 0, killed: 0, skippedRoots: allRoots.length };
  }
  const skippedRoots = Math.max(0, allRoots.length - uniqueRoots.length);

  let processLines = await psLines(2000);
  let forks = parseForkservers(processLines);
  let killed = 0;
  const maxKills = Math.max(0, opts.maxKills ?? 200);
  for (const root of uniqueRoots) {
    if (killed >= maxKills) break;
    const existingRoot = await existingPathVariant(root);
    if (!existingRoot) continue;
    const isos = await listIsolationDirs(existingRoot);
    for (const iso of isos) {
      if (killed >= maxKills) break;
      await buck2Kill(existingRoot, iso, 5000);
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
      if (!uniqueRoots.some((root) => pathsEquivalent(absRepo, root))) continue;
      matchedThisPass++;
      const existingRoot = await existingPathVariant(absRepo);
      if (existingRoot) {
        await buck2Kill(existingRoot, iso, 5000);
      }
      if (isPidAlive(f.pid)) {
        try {
          process.kill(f.pid, "SIGKILL");
        } catch {}
      }
      if (parentIsMatchingBuckDaemon(processLines, f.ppid, iso) && isPidAlive(f.ppid)) {
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
    processLines = await psLines(2000);
    forks = parseForkservers(processLines);
  }

  const lines2 = await psLines(2000);
  for (const root of uniqueRoots) {
    if (killed >= maxKills) break;
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
  return { roots: uniqueRoots.length, killed, skippedRoots };
}
