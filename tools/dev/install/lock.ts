#!/usr/bin/env node
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function repoIdentity(): string {
  // Prefer the real workspace root inferred from ZX_INIT (points to real repo, not temp clones)
  const zxInit = process.env.ZX_INIT || "";
  if (zxInit) {
    try {
      const p = path.resolve(zxInit);
      // zx-init.mjs lives at <repo>/tools/dev/zx-init.mjs
      return path.dirname(path.dirname(path.dirname(p)));
    } catch {}
  }
  // Fallback to current working directory
  return process.cwd();
}

function lockPathFor(key: string): string {
  const id = repoIdentity();
  const h = crypto.createHash("sha256").update(`${id}::${key}`).digest("hex").slice(0, 16);
  // Use a stable system-wide directory to avoid test sandboxes or dev shells changing TMPDIR.
  // On POSIX, prefer /tmp; on Windows, fallback to os.tmpdir().
  const base =
    process.platform === "win32" ? path.join(os.tmpdir(), "bucknix-locks") : "/tmp/bucknix-locks";
  return path.join(base, `lock-${h}.lck`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withExclusiveInstallLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; staleMs?: number; verbose?: boolean },
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
  const p = lockPathFor(key);
  const parent = path.dirname(p);
  await fsp.mkdir(parent, { recursive: true });
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
    try {
      // Acquire by creating a directory atomically (portable and robust)
      await fsp.mkdir(p);
      const ownerFile = path.join(p, "owner.json");
      const payload =
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n";
      await fsp.writeFile(ownerFile, payload, "utf8");
      // Register cleanup
      const cleanup = async () => {
        try {
          // Remove owner file first, then the directory lock
          await fsp.rm(p, { recursive: true, force: true });
        } catch {}
      };
      process.once("exit", () => void cleanup());
      process.once("SIGINT", () => {
        void cleanup();
        process.exit(130);
      });
      process.once("SIGTERM", () => {
        void cleanup();
        process.exit(143);
      });
      // Heartbeat: periodically refresh mtime to signal liveness
      const hb = setInterval(async () => {
        try {
          const ownerFile = path.join(p, "owner.json");
          const now = new Date();
          await fsp.utimes(ownerFile, now, now).catch(() => {});
        } catch {}
      }, 4000);
      try {
        return await fn();
      } finally {
        clearInterval(hb);
        await cleanup();
      }
    } catch (e: any) {
      // Already locked — check for staleness or wait (and optional force)
      try {
        const st = await fsp.stat(p).catch(async (e: any) => {
          // If legacy file-based lock remains, convert handling to directory semantics
          if (e && e.code === "ENOTDIR") return await fsp.stat(p).catch(() => null);
          return null;
        });
        let age = 0;
        if (st) age = Date.now() - st.mtimeMs;
        if (envForce || Date.now() - start > forceAfterMs) {
          if (verbose) console.error(`[install-lock] force-clearing lock ${p}`);
          await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        // If the owner pid is gone, consider the lock stale regardless of age
        try {
          const ownerFile = path.join(p, "owner.json");
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
          // If no PID content could be parsed, treat as stale after a short grace
          if (!pid && age > Math.min(30_000, staleMs)) {
            if (verbose) console.error(`[install-lock] removing stale lock without pid ${p}`);
            await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
            continue;
          }
        } catch {}
        if (age > staleMs) {
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
        throw new Error(
          `Timed out acquiring install lock (${(timeoutMs / 1000).toFixed(0)}s). Another process is preparing node_modules. Try again shortly.\nLock: ${p}`,
        );
      }
      if (verbose && delay >= 1000 && (Date.now() - start) % 5000 < delay) {
        console.error(
          `[install-lock] waiting for lock ${p} (${Math.floor((Date.now() - start) / 1000)}s)`,
        );
      }
      await sleep(delay);
      delay = Math.min(delay * 1.5, 2000);
    }
  }
}
