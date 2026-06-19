#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { cleanupOrphanBuckDaemons } from "./buck-orphan-cleanup";
import { appendVerifyLogLine } from "./process-control";
import { cleanupRegisteredBuckIsolations } from "./registered-buck-cleanup";

const execFileAsync = promisify(execFile);

async function cleanupVerifyRootBuckOut(root: string): Promise<string[]> {
  const buckOut = path.join(root, "buck-out");
  const removed: string[] = [];
  const entries = await fsp.readdir(buckOut, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const name = entry.name;
    const verifyOwned =
      name === ".metadata_never_index" ||
      name === "test-logs" ||
      name === "tmp" ||
      name === "zx_shims" ||
      name === "v2" ||
      name.startsWith("v-") ||
      name.startsWith("verify-nested-") ||
      name.startsWith("deployment-query-") ||
      name.startsWith("zxtest-shared-");
    if (!verifyOwned) continue;
    if (name === "v2") {
      continue;
    }
    if (
      name.startsWith("v-") ||
      name.startsWith("verify-nested-") ||
      name.startsWith("deployment-query-") ||
      name.startsWith("zxtest-shared-")
    ) {
      await execFileAsync("buck2", ["--isolation-dir", name, "kill"], { cwd: root }).catch(
        () => {},
      );
    }
    await fsp.rm(path.join(buckOut, name), { recursive: true, force: true }).catch(() => {});
    removed.push(name);
  }
  await fsp.rmdir(buckOut).catch(() => {});
  return removed.sort();
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
          includeOwnerlessEphemeral: false,
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
    const removedRootEntries = await opts.timedPhase(
      "final-cleanup-root-buck-out",
      async () => await cleanupVerifyRootBuckOut(opts.root),
    );
    if (removedRootEntries.length > 0) {
      await appendVerifyLogLine(
        opts.logFile,
        `[verify] final root buck-out cleanup: removed=${removedRootEntries.join(",")}`,
      );
    }
  } catch {
  } finally {
    if (previousGrace === undefined) delete process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS;
    else process.env.VBR_BUCK_ORPHAN_STALE_GRACE_SECS = previousGrace;
  }
}
