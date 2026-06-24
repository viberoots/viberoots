#!/usr/bin/env zx-wrapper
// Builds/maintains unified pnpm store under hidden viberoots workspace state.
import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  computeImporterLabel,
  findImporterLockfiles,
  isSupportedImporterLabel,
} from "../lib/importers";
import { unifiedPnpmStoreEpochDigest } from "./unified-pnpm-store-epoch";
import { prepareExactPnpmStore } from "./update-pnpm-hash/lockfile";
import { mergePnpmStore } from "./update-pnpm-hash/prefetched-store";

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
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

async function mergeExactStorePathIntoUnifiedStore(opts: {
  exactStorePath: string;
  unifyStore: string;
}): Promise<void> {
  const archive = path.join(opts.exactStorePath, "store.tar");
  if (fs.existsSync(archive)) {
    await ensureDir(opts.unifyStore);
    await $`tar -xf ${archive} -C ${opts.unifyStore}`;
    return;
  }
  await mergePnpmStore(opts.exactStorePath, opts.unifyStore);
}

function pnpmStoreVersionNumber(name: string): number | null {
  const match = name.match(/^v(\d+)$/);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

async function pruneStalePnpmStoreVersions(unifyStore: string): Promise<void> {
  let ents: Array<fsp.Dirent>;
  try {
    ents = await fsp.readdir(unifyStore, { withFileTypes: true });
  } catch {
    return;
  }
  const versions = ents
    .filter((ent) => ent.isDirectory())
    .flatMap((ent) => {
      const version = pnpmStoreVersionNumber(ent.name);
      return version === null ? [] : [{ name: ent.name, version }];
    });
  if (versions.length <= 1) return;
  const currentVersion = Math.max(...versions.map((entry) => entry.version));
  for (const entry of versions) {
    if (entry.version >= currentVersion) continue;
    await fsp.rm(path.join(unifyStore, entry.name), { recursive: true, force: true });
  }
}

function unifiedStoreRecoveryMessage(lockPath: string, waitTimeoutMs: number): string {
  return [
    `timed out waiting for unified pnpm store lock after ${waitTimeoutMs}ms (${lockPath})`,
    "[unified-pnpm-store] Recovery steps:",
    "  1) Stop any stuck prewarm/install process in another shell.",
    `  2) Remove stale lock: rm -f "${lockPath}"`,
    "  3) Rebuild unified store: i",
    "  4) Retry verify/build command (for example: v projects/apps/my-app)",
    "  5) Optional: raise wait timeout with VBR_UNIFIED_STORE_LOCK_WAIT_TIMEOUT_MS=<ms>",
  ].join("\n");
}

async function withFileLock(lockPath: string, fn: () => Promise<void>) {
  const lockFdPath = lockPath + ".lock";
  let fd = -1;
  const startedAt = Date.now();
  const waitTimeoutMs =
    Number.parseInt(process.env.VBR_UNIFIED_STORE_LOCK_WAIT_TIMEOUT_MS || "300000", 10) || 300000;
  const staleAgeMs =
    Number.parseInt(process.env.VBR_UNIFIED_STORE_LOCK_STALE_AGE_MS || "300000", 10) || 300000;
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
  const stateDir = path.join(repo, ".viberoots", "workspace", "buck", "unified-pnpm-store");
  await ensureDir(stateDir);

  // Invalidate the unified store whenever either package hashes or the assembly logic changes.
  const epochHash = await unifiedPnpmStoreEpochDigest(repo);
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
      await pruneStalePnpmStoreVersions(cur);
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
        await pruneStalePnpmStoreVersions(cur);
        console.log(cur);
        return;
      }
    } catch {}

    await ensureDir(unifyStore);

    // Discover PNPM importer lockfiles and build unfixed stores
    const lockfiles = await findImporterLockfiles(["pnpm-lock.yaml"]);
    const importers = lockfiles
      .map((lf) => computeImporterLabel(lf))
      .filter((importer) => importer === "viberoots" || isSupportedImporterLabel(importer));
    // Always include repo-root importer '.' if lockfile present there
    const uniq = Array.from(new Set(importers));

    // Build the local unified prewarm directly from exact prefetched stores.
    // install-deps has already refreshed hashes and prefetched these stores,
    // so avoid re-running fixed-output validation inside Nix just to assemble
    // a shared writable cache for future local pnpm operations.
    for (const imp of uniq) {
      const { exactStorePath } = await prepareExactPnpmStore({ repoRoot: repo, importer: imp });
      await mergeExactStorePathIntoUnifiedStore({ exactStorePath, unifyStore });
    }
    await pruneStalePnpmStoreVersions(unifyStore);

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
