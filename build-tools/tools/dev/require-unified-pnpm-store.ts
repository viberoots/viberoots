#!/usr/bin/env zx-wrapper
// Builds/maintains unified pnpm store under buck-out/.unified-pnpm-store.
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

function unifiedStoreRecoveryMessage(lockPath: string, waitTimeoutMs: number): string {
  return [
    `timed out waiting for unified pnpm store lock after ${waitTimeoutMs}ms (${lockPath})`,
    "[unified-pnpm-store] Recovery steps:",
    "  1) Stop any stuck prewarm/install process in another shell.",
    `  2) Remove stale lock: rm -f "${lockPath}"`,
    "  3) Rebuild unified store: i",
    "  4) Retry verify/build command (for example: v projects/apps/my-app)",
    "  5) Optional: raise wait timeout with BNX_UNIFIED_STORE_LOCK_WAIT_TIMEOUT_MS=<ms>",
  ].join("\n");
}

async function withFileLock(lockPath: string, fn: () => Promise<void>) {
  const lockFdPath = lockPath + ".lock";
  let fd = -1;
  const startedAt = Date.now();
  const waitTimeoutMs =
    Number.parseInt(process.env.BNX_UNIFIED_STORE_LOCK_WAIT_TIMEOUT_MS || "300000", 10) || 300000;
  const staleAgeMs =
    Number.parseInt(process.env.BNX_UNIFIED_STORE_LOCK_STALE_AGE_MS || "300000", 10) || 300000;
  const sleepMs = 100;

  const pidAlive = (pid: number): boolean => {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const readLockMeta = async (): Promise<{ pid: number | null; startedAtMs: number | null }> => {
    try {
      const txt = (await fsp.readFile(lockFdPath, "utf8")).trim();
      if (!txt) return { pid: null, startedAtMs: null };
      const parsed = JSON.parse(txt);
      const pid = Number.isFinite(parsed?.pid) ? Number(parsed.pid) : null;
      const startedAtMs = Number.isFinite(parsed?.startedAtMs) ? Number(parsed.startedAtMs) : null;
      return { pid, startedAtMs };
    } catch {
      return { pid: null, startedAtMs: null };
    }
  };

  const safeUnlinkLock = async () => {
    try {
      await fsp.unlink(lockFdPath);
    } catch {}
  };

  try {
    // Spin until we acquire exclusive creation of the lock file, with stale lock recovery.
    while (true) {
      try {
        fd = fs.openSync(lockFdPath, "wx");
        try {
          fs.writeFileSync(
            fd,
            JSON.stringify({
              pid: process.pid,
              startedAtMs: Date.now(),
            }),
            "utf8",
          );
        } catch {}
        break;
      } catch {
        const elapsed = Date.now() - startedAt;
        if (elapsed > waitTimeoutMs) {
          throw new Error(unifiedStoreRecoveryMessage(lockFdPath, waitTimeoutMs));
        }
        const meta = await readLockMeta();
        if (meta.pid !== null && !pidAlive(meta.pid)) {
          await safeUnlinkLock();
          continue;
        }
        try {
          const st = await fsp.stat(lockFdPath);
          if (Date.now() - st.mtimeMs > staleAgeMs) {
            await safeUnlinkLock();
            continue;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, sleepMs));
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
  const hashesPath = path.join(repo, "build-tools", "tools", "nix", "node-modules.hashes.json");
  const hashesTxt = await readTextSafe(hashesPath);
  const epochHash = sha256Hex(hashesTxt || "no-hashes");
  const unifyDir = path.join(stateDir, `store-${epochHash}`);
  const unifyStore = path.join(unifyDir, "store");
  const pathFile = path.join(stateDir, "path");
  const expectedStoreDirName = path.basename(unifyDir);

  const isCurrentEpochStore = (storePath: string): boolean => {
    try {
      if (!storePath) return false;
      const abs = path.resolve(storePath);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return false;
      // Store path should be ".../.unified-pnpm-store/store-<epoch>/store"
      const parent = path.basename(path.dirname(abs));
      return parent === expectedStoreDirName;
    } catch {
      return false;
    }
  };

  // Fast path: only reuse when marker points at the current hashes epoch.
  try {
    const cur = (await readTextSafe(pathFile)).trim();
    if (isCurrentEpochStore(cur)) {
      // Ensure existing store is user-writable so buck-out is removable without sudo
      try {
        await $`bash --noprofile --norc -c ${`chmod -R u+rwX "${cur}" || true`}`;
      } catch {}
      console.log(cur);
      return;
    }
  } catch {}

  await withFileLock(path.join(stateDir, "require"), async () => {
    // Re-check after acquiring lock
    try {
      const cur = (await readTextSafe(pathFile)).trim();
      if (isCurrentEpochStore(cur)) {
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
      })`nix build --impure --accept-flake-config --no-link --print-out-paths path:${repo}#${attr}`.nothrow();
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
        await $`bash --noprofile --norc -c ${`set -euo pipefail
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
      await $`bash --noprofile --norc -c ${`set -euo pipefail
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
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
