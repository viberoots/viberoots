#!/usr/bin/env zx-wrapper
/**
 * require-unified-pnpm-store.ts
 * - Creates a unified prewarmed pnpm store under buck-out/.unified-pnpm-store/<hash>
 * - Hash is derived from tools/nix/node-modules.hashes.json so changes to lock hashes rotate the store
 * - Safe for concurrent invocations via a simple lock file
 * - Writes buck-out/.unified-pnpm-store/path with the absolute store path for consumers
 *
 * Usage:
 *   node tools/dev/require-unified-pnpm-store.ts
 *
 * Effects:
 *   - Populates a shared pnpm store directory by building per-importer pnpm-store-unfixed.<importer>
 *   - Subsequent Buck/Nix actions that honor LOCAL_PNPM_STORE + NIX_USE_PREFETCHED_PNPM_STORE will reuse it
 */
import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { findImporterLockfiles, computeImporterLabel } from "../lib/importers.ts";

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function sanitizeImporter(importer: string): string {
  return importer
    .replace(/\/\//g, "")
    .replace(/:/g, "-")
    .replace(/[\/\s]+/g, "-");
}

async function readTextSafe(p: string): Promise<string> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return "";
  }
}

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function withFileLock(lockPath: string, fn: () => Promise<void>) {
  const lockFdPath = lockPath + ".lock";
  let fd = -1;
  try {
    // Spin until we acquire exclusive creation of the lock file
    while (true) {
      try {
        fd = fs.openSync(lockFdPath, "wx");
        break;
      } catch (_e: any) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await fn();
  } finally {
    try {
      if (fd >= 0) fs.closeSync(fd);
    } catch {}
    try {
      await fsp.unlink(lockFdPath);
    } catch {}
  }
}

async function main() {
  const repo = process.cwd();
  const buckOut = path.join(repo, "buck-out");
  const stateDir = path.join(buckOut, ".unified-pnpm-store");
  await ensureDir(stateDir);

  // Hash the node-modules hashes file as a coarse epoch for the unified store
  const hashesPath = path.join(repo, "tools", "nix", "node-modules.hashes.json");
  const hashesTxt = await readTextSafe(hashesPath);
  const epochHash = sha256Hex(hashesTxt || "no-hashes");
  const unifyDir = path.join(stateDir, `store-${epochHash}`);
  const unifyStore = path.join(unifyDir, "store");
  const pathFile = path.join(stateDir, "path");

  // Fast path: if path file points to an existing directory, we're done
  try {
    const cur = (await readTextSafe(pathFile)).trim();
    if (cur && fs.existsSync(cur) && fs.statSync(cur).isDirectory()) {
      // Ensure existing store is user-writable so buck-out is removable without sudo
      try {
        await $`bash -lc ${`chmod -R u+rwX "${cur}" || true`}`;
      } catch {}
      console.log(cur);
      return;
    }
  } catch {}

  await withFileLock(path.join(stateDir, "require"), async () => {
    // Re-check after acquiring lock
    try {
      const cur = (await readTextSafe(pathFile)).trim();
      if (cur && fs.existsSync(cur) && fs.statSync(cur).isDirectory()) {
        console.log(cur);
        return;
      }
    } catch {}

    await ensureDir(unifyStore);

    // Discover PNPM importer lockfiles and build unfixed stores
    const lockfiles = await findImporterLockfiles(["pnpm-lock.yaml"]);
    const importers = lockfiles.map((lf) => computeImporterLabel(lf));
    // Always include repo-root importer '.' if lockfile present there
    const uniq = Array.from(new Set(importers));

    // Build and merge each importer's unfixed pnpm store
    for (const imp of uniq) {
      const attr =
        imp === "." ? "pnpm-store-unfixed.default" : `pnpm-store-unfixed.${sanitizeImporter(imp)}`;
      // Build quietly, print logs only on failure
      const built = await $({
        stdio: "pipe",
      })`nix build --impure --accept-flake-config --no-link --print-out-paths .#${attr}`.nothrow();
      if (built.exitCode !== 0) {
        // Ignore importers that fail to build unfixed store (e.g., missing lock); proceed
        continue;
      }
      const outPath =
        String(built.stdout || "")
          .trim()
          .split(/\s+/)
          .pop() || "";
      if (!outPath) continue;
      const src = path.join(outPath, "store");
      try {
        await $`bash -lc ${`set -euo pipefail
          if [ -d "${src}" ]; then
            # Copy without preserving owner/perms to ensure user-writable cleanup under buck-out
            rsync -rlt --no-perms --no-owner --no-group "${src}/" "${unifyStore}/" >/dev/null 2>&1 || true
          fi
        `}`;
      } catch {
        // best-effort copy
      }
    }

    // Ensure everything under the unified store is user-writable so buck-out is removable without sudo
    try {
      await $`bash -lc ${`set -euo pipefail
        chmod -R u+rwX "${unifyDir}" || true
      `}`;
    } catch {}

    // Write path file atomically
    await ensureDir(stateDir);
    const tmp = path.join(stateDir, `.path.${process.pid}.${Date.now()}`);
    await fsp.writeFile(tmp, unifyStore + "\n", "utf8");
    await fsp.rename(tmp, pathFile);
    console.log(unifyStore);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
