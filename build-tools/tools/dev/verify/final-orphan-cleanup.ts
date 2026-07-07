#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { markMacosMetadataNeverIndex } from "../../lib/macos-metadata";
import { buckProcessTableLines } from "../../lib/process-inspection";
import { cleanupOrphanBuckDaemons } from "./buck-orphan-cleanup";
import { appendVerifyLogLine } from "./process-control";
import { cleanupRegisteredBuckIsolations } from "./registered-buck-cleanup";
import { etimeToSeconds } from "./verify-owned-orphan-cleanup";

const execFileAsync = promisify(execFile);

function verifyOwnedBuckOutEntry(name: string): boolean {
  return (
    name === "test-logs" ||
    name === "tmp" ||
    name === "zx_shims" ||
    name === "v2" ||
    name.startsWith("v-") ||
    name.startsWith("verify-nested-") ||
    name.startsWith("deployment-query-") ||
    name.startsWith("zxtest-shared-") ||
    name.startsWith("exporter-shared-")
  );
}

async function realExistingRoot(root: string): Promise<string | null> {
  const trimmed = String(root || "").trim();
  if (!trimmed) return null;
  const resolved = path.resolve(trimmed);
  try {
    return await fsp.realpath(resolved);
  } catch {
    return null;
  }
}

async function activeSourceCleanupRoots(root: string): Promise<string[]> {
  const candidates = [
    root,
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    path.join(root, ".viberoots", "current"),
    path.join(root, "viberoots"),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const real = await realExistingRoot(candidate);
    if (!real || seen.has(real)) continue;
    if (real !== path.resolve(root)) {
      const zxInit = path.join(real, "build-tools", "tools", "dev", "zx-init.mjs");
      try {
        await fsp.access(zxInit);
      } catch {
        continue;
      }
    }
    seen.add(real);
    out.push(real);
  }
  return out;
}

async function cleanupVerifyRootBuckOut(root: string): Promise<string[]> {
  const buckOut = path.join(root, "buck-out");
  const removed: string[] = [];
  const entries = await fsp.readdir(buckOut, { withFileTypes: true }).catch(() => []);
  const broadCleanup = process.env.VBR_VERIFY_BROAD_BUCK_OUT_CLEANUP === "1";
  for (const entry of entries) {
    const name = entry.name;
    const verifyOwned = verifyOwnedBuckOutEntry(name);
    if (!verifyOwned) continue;
    const ownerPid = (name.match(/^v-(\d+)-/) || name.match(/^verify-nested-(\d+)-/))?.[1] || "";
    if (ownerPid) {
      try {
        process.kill(Number(ownerPid), 0);
        continue;
      } catch {}
    } else if (!broadCleanup) {
      continue;
    }
    if (name === "v2") {
      await execFileAsync("buck2", ["kill"], { cwd: root }).catch(() => {});
    } else if (
      name.startsWith("v-") ||
      name.startsWith("verify-nested-") ||
      name.startsWith("deployment-query-") ||
      name.startsWith("zxtest-shared-") ||
      name.startsWith("exporter-shared-")
    ) {
      if (name === "v2") {
        await execFileAsync("buck2", ["kill"], { cwd: root }).catch(() => {});
      } else {
        await execFileAsync("buck2", ["--isolation-dir", name, "kill"], { cwd: root }).catch(
          () => {},
        );
      }
    }
    await fsp.rm(path.join(buckOut, name), { recursive: true, force: true }).catch(() => {});
    removed.push(name);
  }
  await fsp.rmdir(buckOut).catch(() => {});
  await markMacosMetadataNeverIndex(buckOut).catch(() => {});
  return removed.sort();
}

function duplicateManagedBuckPidsFromLines(root: string, lines: string[]): number[] {
  const repoRoot = path.resolve(root);
  const daemonIsoByPid = new Map<number, string>();
  const forksByIso = new Map<string, Array<{ pid: number; ppid: number; ageSec: number }>>();
  for (const line of lines) {
    const parsed = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!parsed) continue;
    const pid = Number(parsed[1]);
    const ppid = Number(parsed[2]);
    const ageSec = etimeToSeconds(parsed[3] || "");
    const cmd = parsed[4] || "";
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const isoArg = String(cmd.match(/--isolation-dir\s+([^\s]+)/)?.[1] || "").trim();
    if (cmd.includes("buck2d[") && isoArg) daemonIsoByPid.set(pid, isoArg);
    if (!cmd.includes("(buck2-forkserver)")) continue;
    const stateDir = String(cmd.match(/--state-dir\s+([^\s]+)/)?.[1] || "").trim();
    const rel = path.relative(path.join(repoRoot, "buck-out"), stateDir);
    const iso = rel.split(path.sep)[0] || isoArg;
    if (!stateDir.startsWith(path.join(repoRoot, "buck-out", iso, "forkserver"))) continue;
    if (!iso.startsWith("devbuild-shared-")) continue;
    const existing = forksByIso.get(iso) || [];
    existing.push({ pid, ppid, ageSec });
    forksByIso.set(iso, existing);
  }
  const pids = new Set<number>();
  for (const [iso, forks] of forksByIso) {
    if (forks.length <= 1) continue;
    const staleForks = forks
      .slice()
      .sort((a, b) => a.ageSec - b.ageSec)
      .slice(1);
    for (const fork of staleForks) {
      pids.add(fork.pid);
      if (daemonIsoByPid.get(fork.ppid) === iso) pids.add(fork.ppid);
    }
  }
  return [...pids].sort((a, b) => a - b);
}

export function duplicateManagedBuckPidsForTest(root: string, lines: string[]): number[] {
  return duplicateManagedBuckPidsFromLines(root, lines);
}

async function cleanupDuplicateManagedBuckDaemons(root: string): Promise<number> {
  const pids = duplicateManagedBuckPidsFromLines(root, await buckProcessTableLines(2000));
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  return pids.length;
}

export async function runFinalOrphanBuckCleanup(opts: {
  root: string;
  logFile: string | null;
  stateFile: string;
  timedPhase: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}): Promise<void> {
  const previousGrace = process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS;
  process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS = "0";
  try {
    const res = await opts.timedPhase(
      "final-cleanup-orphan-buck-daemons",
      async () =>
        await cleanupOrphanBuckDaemons({
          log: async (line) => await appendVerifyLogLine(opts.logFile, line),
          maxKills: 200,
          ignoreLiveOwnerPid: process.pid,
          includeOwnerlessEphemeral: true,
        }),
    );
    await appendVerifyLogLine(
      opts.logFile,
      `[verify] final buck2 orphan cleanup: scanned_forkservers=${res.scanned} candidates=${res.candidates} killed=${res.killed}`,
    );
    const registeredRes = await opts.timedPhase(
      "final-cleanup-registered-buck-isolations",
      async () =>
        await cleanupRegisteredBuckIsolations({
          stateFile: opts.stateFile,
          log: async (line) => await appendVerifyLogLine(opts.logFile, line),
          maxKills: Number.MAX_SAFE_INTEGER,
        }),
    );
    await appendVerifyLogLine(
      opts.logFile,
      `[verify] final registered buck cleanup: scanned_isolations=${registeredRes.scanned} candidates=${registeredRes.candidates} killed=${registeredRes.killed}`,
    );
    const cleanupRoots = await activeSourceCleanupRoots(opts.root);
    for (const cleanupRoot of cleanupRoots) {
      const duplicateKills = await opts.timedPhase(
        "final-cleanup-duplicate-root-buck-daemons",
        async () => await cleanupDuplicateManagedBuckDaemons(cleanupRoot),
      );
      if (duplicateKills > 0) {
        await appendVerifyLogLine(
          opts.logFile,
          `[verify] final duplicate root buck daemon cleanup: root=${cleanupRoot} killed_pids=${duplicateKills}`,
        );
      }
      const removedRootEntries = await opts.timedPhase(
        "final-cleanup-root-buck-out",
        async () => await cleanupVerifyRootBuckOut(cleanupRoot),
      );
      if (removedRootEntries.length > 0) {
        await appendVerifyLogLine(
          opts.logFile,
          `[verify] final root buck-out cleanup: root=${cleanupRoot} removed=${removedRootEntries.join(",")}`,
        );
      }
    }
  } catch {
  } finally {
    if (previousGrace === undefined) delete process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS;
    else process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS = previousGrace;
  }
}
