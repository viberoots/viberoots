#!/usr/bin/env zx-wrapper
/**
 * tools/dev/clean-temp-outs.ts
 * Best-effort cleanup of ephemeral Buck/Nix temp artifacts to avoid GC roots/bloat.
 *
 * - Removes buck-out/tmp/buck-impure-* directories older than N minutes (default 30).
 * - Optionally removes a repo-root "result" symlink if present and dangling.
 */
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getFlagStr } from "../lib/cli.ts";

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

  // 2) Optional: remove dangling repo-root "result" symlink (common from ad-hoc nix build)
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
