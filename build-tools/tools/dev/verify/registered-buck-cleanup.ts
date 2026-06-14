import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  buck2Kill,
  existingPathVariant,
  isPidAlive,
  macosPathVariants,
  parsePsLine,
  psLines,
} from "./buck-orphan-cleanup-lib";
import { parseVerifyOwnedState, type RegisteredBuckIsolation } from "./owned-process-state";
import { listCandidateStateFiles } from "./verify-owned-process-scan";

function uniqueRegisteredIsolations(
  isolations: RegisteredBuckIsolation[],
): RegisteredBuckIsolation[] {
  const seen = new Map<string, RegisteredBuckIsolation>();
  for (const entry of isolations) {
    seen.set(`${path.resolve(entry.repoRoot)}\0${entry.iso}`, {
      ...entry,
      repoRoot: path.resolve(entry.repoRoot),
    });
  }
  return [...seen.values()];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function killRegisteredIsolations(opts: {
  isolations: RegisteredBuckIsolation[];
  log?: (line: string) => Promise<void>;
  maxKills?: number;
  reason: "cleanup" | "orphan cleanup";
}): Promise<{ scanned: number; candidates: number; killed: number; processKilled: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 200);
  const isolations = uniqueRegisteredIsolations(opts.isolations);
  const lines = await psLines(5000);
  const liveEntries = isolations.filter((entry) =>
    registeredIsolationProcessPidsFromLines(entry, lines).some((pid) => isPidAlive(pid)),
  );
  let killed = 0;
  let processKilled = 0;
  const processed: RegisteredBuckIsolation[] = [];
  for (const entry of liveEntries) {
    if (killed >= maxKills) break;
    const firstProcessKills = await killRegisteredIsolationProcesses(entry, opts.log);
    processKilled += firstProcessKills;
    if (firstProcessKills > 0) {
      await sleep(100);
    }
    const remaining = registeredIsolationProcessPidsFromLines(entry, await psLines(2000)).some(
      (pid) => isPidAlive(pid),
    );
    const existingRoot = await existingPathVariant(entry.repoRoot);
    if (remaining && existingRoot) {
      await buck2Kill(existingRoot, entry.iso, 1000);
      processKilled += await killRegisteredIsolationProcesses(entry, opts.log);
    }
    processed.push(entry);
    killed++;
    if (opts.log) {
      await opts.log(
        `[verify] registered buck isolation ${opts.reason}: killed iso=${entry.iso} kind=${entry.kind} owner_pid=${entry.ownerPid} repo=${entry.repoRoot}`,
      );
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    let processKills = 0;
    for (const entry of processed) {
      processKills += await killRegisteredIsolationProcesses(entry, opts.log);
    }
    processKilled += processKills;
    if (processKills === 0) break;
    await sleep(100);
  }
  return { scanned: isolations.length, candidates: liveEntries.length, killed, processKilled };
}

export function registeredIsolationProcessPidsFromLines(
  entry: RegisteredBuckIsolation,
  lines: string[],
): number[] {
  const repoRoot = path.resolve(entry.repoRoot);
  const stateDirs = macosPathVariants(path.join(repoRoot, "buck-out", entry.iso, "forkserver"));
  const daemonNeedle = ` --isolation-dir ${entry.iso}`;
  const forkserverSuffix = `/buck-out/${entry.iso}/forkserver`;
  const rows = lines.flatMap((line) => {
    const parsed = parsePsLine(line);
    return parsed ? [{ ...parsed, line }] : [];
  });
  const commandByPid = new Map(rows.map((row) => [row.pid, row.line]));
  const pids: number[] = [];
  for (const row of rows) {
    const isForkserver =
      row.line.includes("(buck2-forkserver)") &&
      (stateDirs.some((stateDir) => row.line.includes(`--state-dir ${stateDir}`)) ||
        row.line.includes(forkserverSuffix));
    const isDaemon = row.line.includes("buck2d[") && row.line.includes(daemonNeedle);
    if (!isForkserver && !isDaemon) continue;
    pids.push(row.pid);
    const parentCommand = commandByPid.get(row.ppid) || "";
    if (isForkserver && parentCommand.includes("buck2d[") && parentCommand.includes(daemonNeedle)) {
      pids.push(row.ppid);
    }
  }
  return Array.from(new Set(pids)).filter((pid) => pid > 1);
}

async function killRegisteredIsolationProcesses(
  entry: RegisteredBuckIsolation,
  log?: (line: string) => Promise<void>,
): Promise<number> {
  let killed = 0;
  const lines = await psLines(2000);
  const pids = registeredIsolationProcessPidsFromLines(entry, lines);
  for (const pid of pids) {
    if (!isPidAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
      killed++;
    } catch {}
  }
  if (log && killed > 0) {
    await log(
      `[verify] registered buck isolation process cleanup: killed_pids=${killed} iso=${entry.iso} repo=${path.resolve(entry.repoRoot)}`,
    );
  }
  return killed;
}

export async function cleanupRegisteredBuckIsolations(opts: {
  stateFile: string;
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const stateFile = String(opts.stateFile || "").trim();
  if (!stateFile) return { scanned: 0, candidates: 0, killed: 0 };
  const txt = await fsp.readFile(stateFile, "utf8").catch(() => "");
  const parsed = parseVerifyOwnedState(txt);
  return await killRegisteredIsolations({
    isolations: parsed.isolations,
    log: opts.log,
    maxKills: opts.maxKills,
    reason: "cleanup",
  });
}

export async function cleanupOrphanRegisteredBuckIsolations(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const stateFiles = await listCandidateStateFiles();
  const isolations: RegisteredBuckIsolation[] = [];
  for (const stateFile of stateFiles) {
    const txt = await fsp.readFile(stateFile, "utf8").catch(() => "");
    const parsed = parseVerifyOwnedState(txt);
    isolations.push(...parsed.isolations.filter((entry) => !isPidAlive(entry.ownerPid)));
  }
  return await killRegisteredIsolations({
    isolations,
    log: opts.log,
    maxKills: opts.maxKills,
    reason: "orphan cleanup",
  });
}
