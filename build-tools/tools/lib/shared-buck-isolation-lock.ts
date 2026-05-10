import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { processStartSignature as inspectProcessStartSignature } from "./process-inspection";

type LockOwner = {
  pid: number;
  startSig: string;
  createdAt: string;
  isolation: string;
};

const initialized = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processStartSignature(pid: number): Promise<string | null> {
  return await inspectProcessStartSignature(pid);
}

function sanitizeIsolationName(isolation: string): string {
  return String(isolation || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_");
}

export function isSharedBuckIsolation(isolation: string): boolean {
  const value = String(isolation || "").trim();
  return /^exporter-shared-/.test(value) || /^devbuild-shared-/.test(value);
}

async function staleLockOwner(lockDir: string): Promise<boolean> {
  const raw = await fsp.readFile(path.join(lockDir, "owner.json"), "utf8").catch(() => "");
  if (!raw.trim()) {
    const stat = await fsp.stat(lockDir).catch(() => null);
    const ageMs = stat ? Date.now() - stat.mtimeMs : 0;
    return ageMs > 5_000;
  }
  try {
    const owner = JSON.parse(raw) as LockOwner;
    const ownerPid = Number(owner.pid);
    if (!pidAlive(ownerPid)) return true;
    const expectedSig = typeof owner.startSig === "string" ? owner.startSig.trim() : "";
    if (!expectedSig) return false;
    const currentSig = await processStartSignature(ownerPid);
    if (!currentSig) return false;
    return currentSig !== expectedSig;
  } catch {
    return true;
  }
}

async function acquireLock(lockDir: string, isolation: string): Promise<() => Promise<void>> {
  const timeoutMs = Math.max(
    1_000,
    Number.parseInt(String(process.env.BNX_SHARED_BUCK_LOCK_TIMEOUT_MS || "300000"), 10) || 300_000,
  );
  const started = Date.now();
  while (true) {
    try {
      await fsp.mkdir(lockDir, { recursive: false });
      const startSig = await processStartSignature(process.pid);
      const owner: LockOwner = {
        pid: process.pid,
        startSig: startSig || "",
        createdAt: new Date().toISOString(),
        isolation,
      };
      await fsp.writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner), "utf8");
      return async () => {
        await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {});
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      if (await staleLockOwner(lockDir)) {
        await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for shared Buck isolation startup lock: ${isolation}`);
      }
      await sleep(100);
    }
  }
}

export async function withSharedBuckIsolationStartupLock<T>(
  repoRoot: string,
  isolation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const resolvedRoot = path.resolve(repoRoot || process.cwd());
  const iso = String(isolation || "").trim();
  if (!isSharedBuckIsolation(iso)) return await fn();
  const key = `${resolvedRoot}\0${iso}`;
  if (initialized.has(key)) return await fn();

  const lockRoot = path.join(resolvedRoot, "buck-out", "tmp", "shared-isolation-locks");
  await fsp.mkdir(lockRoot, { recursive: true });
  const lockDir = path.join(lockRoot, `${sanitizeIsolationName(iso)}.lock`);
  const release = await acquireLock(lockDir, iso);
  try {
    const result = await fn();
    initialized.add(key);
    return result;
  } finally {
    await release();
  }
}
