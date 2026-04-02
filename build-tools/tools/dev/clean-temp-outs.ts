#!/usr/bin/env zx-wrapper
/**
 * build-tools/tools/dev/clean-temp-outs.ts
 * Best-effort cleanup of ephemeral Buck/Nix temp artifacts to avoid GC roots/bloat.
 *
 * - Removes buck-out/tmp/buck-impure-* directories older than N minutes (default 30).
 * - Removes dead one-shot buck-out/devbuild-* isolation directories immediately.
 * - Removes buck-out/tmp/node-v8-coverage/v-* directories older than N minutes (default 30).
 * - Removes buck-out/tmp/verify-logs/verify-* log files older than N minutes (default 30).
 * - Optionally removes a repo-root "result" symlink if present and dangling.
 */
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getFlagStr } from "../lib/cli.ts";
import { pruneDeadDevBuildIsolationDirs } from "./clean-temp-outs-lib.ts";

type Args = { minutes?: string };

function minutesToMs(s: string | undefined, def = 30): number {
  const n = Math.max(1, Number(s || `${def}`));
  return n * 60 * 1000;
}

async function safeLstat(p: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fsp.lstat(p);
  } catch {
    return null;
  }
}

async function rmRf(p: string): Promise<void> {
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch {}
}

async function main() {
  const repoRoot = process.cwd();
  const argv = { minutes: getFlagStr("minutes", "").trim() } satisfies Args;
  const cutoffMs = Date.now() - minutesToMs(argv.minutes, 30);

  // 1) Remove stale buck-impure-* dirs under buck-out/tmp
  const tmpDir = path.join(repoRoot, "buck-out", "tmp");
  let names: string[] = [];
  try {
    names = await fsp.readdir(tmpDir);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!/^buck-impure-/.test(name)) continue;
    const p = path.join(tmpDir, name);
    const st = await safeLstat(p);
    if (!st) continue;
    const mtime = st.mtimeMs || st.ctimeMs || 0;
    if (mtime > 0 && mtime < cutoffMs) {
      await rmRf(p);
    }
  }

  // 1.5) Remove dead one-shot dev-build isolation dirs under buck-out.
  // These are per-run scratch Buck state directories and can explode Linux watcher counts
  // if they accumulate between runs.
  await pruneDeadDevBuildIsolationDirs(repoRoot).catch(() => []);

  // 2) Remove stale per-verify raw coverage dirs under buck-out/tmp/node-v8-coverage
  const v8covParent = path.join(tmpDir, "node-v8-coverage");
  try {
    const v8names = await fsp.readdir(v8covParent);
    for (const name of v8names) {
      if (!/^v-/.test(name)) continue;
      const p = path.join(v8covParent, name);
      const st = await safeLstat(p);
      if (!st) continue;
      const mtime = st.mtimeMs || st.ctimeMs || 0;
      if (mtime > 0 && mtime < cutoffMs) {
        await rmRf(p);
      }
    }
  } catch {}

  // 2.5) Remove stale verify logs under buck-out/tmp/verify-logs
  const verifyLogsDir = path.join(tmpDir, "verify-logs");
  try {
    const logNames = await fsp.readdir(verifyLogsDir);
    // Keep a small number of the newest verify logs even if old.
    // Rationale: we want verify logs to be available for debugging failures from the last few runs,
    // but still bounded to avoid disk growth.
    const KEEP_VERIFY_LOGS = 10;

    const entries: Array<{ name: string; mtime: number }> = [];
    for (const name of logNames) {
      if (!/^verify-/.test(name)) continue;
      const p = path.join(verifyLogsDir, name);
      const st = await safeLstat(p);
      if (!st || !st.isFile()) continue;
      const mtime = st.mtimeMs || st.ctimeMs || 0;
      if (mtime > 0) entries.push({ name, mtime });
    }

    entries.sort((a, b) => b.mtime - a.mtime);
    const keep = new Set(entries.slice(0, KEEP_VERIFY_LOGS).map((e) => e.name));

    for (const { name, mtime } of entries) {
      if (keep.has(name)) continue;
      if (mtime < cutoffMs) {
        await rmRf(path.join(verifyLogsDir, name));
      }
    }
  } catch {}

  // 2.6) Remove stale verify by-pid pointers under buck-out/tmp/verify-logs/by-pid
  const verifyByPidDir = path.join(verifyLogsDir, "by-pid");
  try {
    const names2 = await fsp.readdir(verifyByPidDir);
    for (const name of names2) {
      if (!/\.log$/.test(name)) continue;
      const p = path.join(verifyByPidDir, name);
      const st = await safeLstat(p);
      if (!st) continue;
      const mtime = st.mtimeMs || st.ctimeMs || 0;
      if (mtime > 0 && mtime < cutoffMs) {
        await rmRf(p);
      }
    }
  } catch {}

  // 3) Optional: remove dangling repo-root "result" symlink (common from ad-hoc nix build)
  const resultLink = path.join(repoRoot, "result");
  try {
    const st = await fsp.lstat(resultLink);
    if (st.isSymbolicLink()) {
      // If target does not exist, remove symlink
      try {
        const target = await fsp.readlink(resultLink).catch(() => "");
        // If readlink succeeds but target path doesn't exist, or readlink fails, unlink it
        if (!target) {
          await fsp.unlink(resultLink);
        } else {
          try {
            await fsp.access(target);
          } catch {
            await fsp.unlink(resultLink);
          }
        }
      } catch {
        try {
          await fsp.unlink(resultLink);
        } catch {}
      }
    }
  } catch {}
}

main().catch(() => {
  // Best-effort; do not fail callers
  process.exit(0);
});
