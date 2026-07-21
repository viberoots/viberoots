#!/usr/bin/env node
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";

function repoIdentity(): string {
  const cwd = process.cwd();

  // Prefer an explicit workspace root only when it matches the current working directory context.
  // This avoids accidental cross-repo lock contention when a parent process exports WORKSPACE_ROOT
  // but a tool is invoked inside a temp repo (common in zx tests).
  const wr = String(process.env.WORKSPACE_ROOT || "").trim();
  if (wr) {
    try {
      const abs = path.resolve(wr);
      if (cwd === abs || cwd.startsWith(abs + path.sep)) return abs;
    } catch {}
  }

  // Prefer the workspace root inferred from ZX_INIT only when it matches the current cwd context.
  const zxInit = String(process.env.ZX_INIT || "").trim();
  if (zxInit) {
    try {
      const p = path.resolve(zxInit);
      // zx-init.mjs lives at <repo>/build-tools/tools/dev/zx-init.mjs
      const root = path.dirname(path.dirname(path.dirname(p)));
      if (cwd === root || cwd.startsWith(root + path.sep)) return root;
    } catch {}
  }

  // Fallback to current working directory.
  return cwd;
}

function lockPathFor(key: string, scopeRootAbs?: string): string {
  const id = scopeRootAbs || repoIdentity();
  const h = crypto.createHash("sha256").update(`${id}::${key}`).digest("hex").slice(0, 16);
  // Use a stable system-wide directory to avoid test sandboxes or dev shells changing TMPDIR.
  // On POSIX, prefer /tmp; on Windows, fallback to os.tmpdir().
  const base =
    process.platform === "win32"
      ? path.join(os.tmpdir(), "viberoots-locks")
      : "/tmp/viberoots-locks";
  return path.join(base, `lock-${h}.lck`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withExclusiveInstallLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; staleMs?: number; verbose?: boolean; scopeRootAbs?: string },
): Promise<T> {
  const envTimeout = Number(process.env.INSTALL_LOCK_TIMEOUT_MS || "");
  const envStale = Number(process.env.INSTALL_LOCK_STALE_MS || "");
  const envForce = String(process.env.INSTALL_LOCK_FORCE || "").trim() === "1";
  const envForceAfter = Number(process.env.INSTALL_LOCK_FORCE_AFTER_MS || "");
  const timeoutMs =
    Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : (opts?.timeoutMs ?? 5 * 60_000); // 5 minutes
  const staleMs =
    Number.isFinite(envStale) && envStale > 0 ? envStale : (opts?.staleMs ?? 15 * 60_000); // 15 minutes
  const forceAfterMs =
    Number.isFinite(envForceAfter) && envForceAfter > 0 ? envForceAfter : Infinity;
  const verbose = opts?.verbose ?? false;
  const p = lockPathFor(key, opts?.scopeRootAbs);
  const parent = path.dirname(p);
  await mkdirWithMacosMetadataExclusion(parent);
  const dbg = String(process.env.INSTALL_LOCK_DEBUG || "").trim() === "1";

  const start = Date.now();
  let delay = 100; // backoff start

  function pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e: any) {
      if (e && (e.code === "ESRCH" || e.code === "ENOENT")) return false; // no such process
      // EPERM or others: assume alive to avoid false positives
      return true;
    }
  }

  while (true) {
    // Acquire by creating a directory atomically (portable and robust).
    // Only acquisition failures should be retried in this loop.
    try {
      await fsp.mkdir(p);
    } catch (e: any) {
      // Already locked — check for staleness or wait (and optional force)
      try {
        const st = await fsp.stat(p).catch(async (e: any) => {
          // If legacy file-based lock remains, convert handling to directory semantics
          if (e && e.code === "ENOTDIR") return await fsp.stat(p).catch(() => null);
          return null;
        });
        let age = st ? Date.now() - st.mtimeMs : 0;
        if (envForce || Date.now() - start > forceAfterMs) {
          if (verbose) console.error(`[install-lock] force-clearing lock ${p}`);
          await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        let liveOwner = false;
        // If the owner pid is gone, consider the lock stale regardless of age
        try {
          const ownerFile = path.join(p, "owner.json");
          const ownerStat = await fsp.stat(ownerFile).catch(() => null);
          if (ownerStat) age = Date.now() - ownerStat.mtimeMs;
          const txt = await fsp.readFile(ownerFile, "utf8").catch(async () => {
            // Legacy file-based lock or missing owner file: read lock file itself best-effort
            try {
              return await fsp.readFile(p, "utf8");
            } catch {
              return "";
            }
          });
          const m = txt.match(/"pid"\s*:\s*(\d+)/);
          const pid = m ? Number(m[1]) : 0;
          if (pid && !pidAlive(pid)) {
            if (verbose)
              console.error(`[install-lock] removing orphaned lock ${p} (pid ${pid} not running)`);
            await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
            continue;
          }
          if (pid) {
            liveOwner = true;
          }
          // If no PID content could be parsed, treat as stale after a short grace
          if (!pid && age > Math.min(30_000, staleMs)) {
            if (verbose) console.error(`[install-lock] removing stale lock without pid ${p}`);
            await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
            continue;
          }
        } catch {}
        if (!liveOwner && age > staleMs) {
          if (verbose)
            console.error(
              `[install-lock] removing stale lock ${p} (age ${(age / 1000).toFixed(1)}s)`,
            );
          await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        if (dbg) {
          try {
            const ownerFile = path.join(p, "owner.json");
            const txt = await fsp.readFile(ownerFile, "utf8").catch(async () => "");
            console.error(`[install-lock] locked by ${txt || "<unknown>"}`);
          } catch {}
        }
      } catch {}
      if (Date.now() - start > timeoutMs) {
        let owner = "";
        try {
          owner = await fsp.readFile(path.join(p, "owner.json"), "utf8");
        } catch {}
        throw new Error(
          `Timed out acquiring install lock (${(timeoutMs / 1000).toFixed(0)}s). Another process is preparing node_modules. Try again shortly.\nLock: ${p}${owner ? `\nOwner: ${owner.trim()}` : ""}`,
        );
      }
      if (verbose && delay >= 1000 && (Date.now() - start) % 5000 < delay) {
        console.error(
          `[install-lock] waiting for lock ${p} (${Math.floor((Date.now() - start) / 1000)}s)`,
        );
      }
      await sleep(delay);
      delay = Math.min(delay * 1.5, 2000);
      continue;
    }

    const ownerFile = path.join(p, "owner.json");
    const startedAt = new Date().toISOString();
    const writeOwner = async () =>
      await fsp.writeFile(
        ownerFile,
        `${JSON.stringify({ pid: process.pid, key, scope: opts?.scopeRootAbs || repoIdentity(), startedAt, heartbeatAt: new Date().toISOString() })}\n`,
        "utf8",
      );
    await writeOwner();
    const cleanup = async () => {
      try {
        await fsp.rm(p, { recursive: true, force: true });
      } catch {}
    };
    const onExit = () => void cleanup();
    const onSigint = () => {
      void cleanup();
      process.exit(130);
    };
    const onSigterm = () => {
      void cleanup();
      process.exit(143);
    };
    process.once("exit", onExit);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    const hb = setInterval(async () => {
      try {
        await writeOwner();
      } catch {}
    }, 4000);
    try {
      return await fn();
    } finally {
      clearInterval(hb);
      process.off("exit", onExit);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      await cleanup();
    }
  }
}
