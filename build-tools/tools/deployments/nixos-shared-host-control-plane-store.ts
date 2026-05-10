#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { sanitizeName } from "../lib/sanitize";
import { throwLockAbort } from "./deployment-control-plane-lock-abort";
import { assertNoBreakGlassFreeze } from "./nixos-shared-host-break-glass-freeze";

type LockOwner = {
  pid: number;
  createdAt: string;
  updatedAt: string;
  leaseExpiresAt: string;
  lockScope: string;
  holderId: string;
  fencingToken: string;
};

export type ControlPlaneLockAbortReason = "cancelled" | "superseded" | "no_longer_admitted";

export type AcquiredControlPlaneLock = {
  lockScope: string;
  fencingToken: string;
  release: () => Promise<void>;
  assertCurrentAuthority: () => Promise<void>;
};

function controlPlaneRoot(recordsRoot: string): string {
  return path.join(path.resolve(recordsRoot), "control-plane");
}

export function submissionPathFor(recordsRoot: string, submissionId: string): string {
  return path.join(controlPlaneRoot(recordsRoot), "submissions", `${submissionId}.json`);
}

export function executionSnapshotPathFor(recordsRoot: string, submissionId: string): string {
  return path.join(controlPlaneRoot(recordsRoot), "snapshots", `${submissionId}.json`);
}

export function submitRequestPathFor(recordsRoot: string, submissionId: string): string {
  return path.join(controlPlaneRoot(recordsRoot), "requests", `${submissionId}.json`);
}

export function runActionRequestPathFor(recordsRoot: string, actionId: string): string {
  return path.join(controlPlaneRoot(recordsRoot), "run-actions", `${actionId}.json`);
}

function idempotencyHash(idempotencyKey: string): string {
  return crypto.createHash("sha256").update(idempotencyKey).digest("hex");
}

export function submitIdempotencyPathFor(recordsRoot: string, idempotencyKey: string): string {
  return path.join(
    controlPlaneRoot(recordsRoot),
    "idempotency",
    "submit",
    `${idempotencyHash(idempotencyKey)}.json`,
  );
}

export function runActionIdempotencyPathFor(recordsRoot: string, idempotencyKey: string): string {
  return path.join(
    controlPlaneRoot(recordsRoot),
    "idempotency",
    "run-action",
    `${idempotencyHash(idempotencyKey)}.json`,
  );
}

export async function writeControlPlaneJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fsp.rename(tempPath, filePath);
}

export async function readControlPlaneJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fsp.readFile(filePath, "utf8")) as T;
}

function lockDirFor(recordsRoot: string, lockScope: string): string {
  return path.join(controlPlaneRoot(recordsRoot), "locks", `${sanitizeName(lockScope)}.lock`);
}

function ownerPathFor(lockDir: string): string {
  return path.join(lockDir, "owner.json");
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function lockLeaseMs(): number {
  return envInt("VBR_DEPLOY_LOCK_LEASE_MS", 30_000);
}

function lockHeartbeatMs(): number {
  return envInt("VBR_DEPLOY_LOCK_HEARTBEAT_MS", 5_000);
}

function lockPollMs(): number {
  return envInt("VBR_DEPLOY_LOCK_POLL_MS", 1_000);
}

function lockWaitTimeoutMs(): number {
  return envInt("VBR_DEPLOY_LOCK_WAIT_TIMEOUT_MS", 30 * 60_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLockOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    return await readControlPlaneJson<LockOwner>(ownerPathFor(lockDir));
  } catch {
    return null;
  }
}

function leaseExpired(owner: LockOwner, now = Date.now()): boolean {
  const expiresAt = Date.parse(owner.leaseExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function sameOwner(owner: LockOwner | null, holderId: string, fencingToken: string): boolean {
  return !!owner && owner.holderId === holderId && owner.fencingToken === fencingToken;
}

export async function acquireControlPlaneLock(
  recordsRoot: string,
  lockScope: string,
  opts?: {
    waitTimeoutMs?: number;
    shouldAbort?: () => Promise<ControlPlaneLockAbortReason | null>;
  },
): Promise<AcquiredControlPlaneLock> {
  await assertNoBreakGlassFreeze(recordsRoot, lockScope);
  const lockDir = lockDirFor(recordsRoot, lockScope);
  await fsp.mkdir(path.dirname(lockDir), { recursive: true });
  const holderId = `holder-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const fencingToken = `fence-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const writeOwner = async () => {
    const now = new Date();
    await writeControlPlaneJson(ownerPathFor(lockDir), {
      pid: process.pid,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + lockLeaseMs()).toISOString(),
      lockScope,
      holderId,
      fencingToken,
    } satisfies LockOwner);
  };
  const tryAcquire = async (): Promise<boolean> => {
    try {
      await fsp.mkdir(lockDir);
      await writeOwner();
      return true;
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + (opts?.waitTimeoutMs ?? lockWaitTimeoutMs());
  while (true) {
    const abortReason = await opts?.shouldAbort?.();
    if (abortReason) throwLockAbort(abortReason);
    if (await tryAcquire()) {
      const postAcquireAbortReason = await opts?.shouldAbort?.();
      if (!postAcquireAbortReason) break;
      await fsp.rm(lockDir, { recursive: true, force: true });
      throwLockAbort(postAcquireAbortReason);
    }
    const owner = await readLockOwner(lockDir);
    if (!owner || !pidAlive(owner.pid) || leaseExpired(owner)) {
      await fsp.rm(lockDir, { recursive: true, force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw Object.assign(new Error(`shared control-plane lock timeout for ${lockScope}`), {
        code: "lock_timeout",
      });
    }
    await sleep(lockPollMs());
  }
  let released = false;
  const heartbeat = setInterval(
    async () => {
      try {
        const owner = await readLockOwner(lockDir);
        if (!sameOwner(owner, holderId, fencingToken) || leaseExpired(owner)) {
          clearInterval(heartbeat);
          return;
        }
        const now = new Date();
        await writeControlPlaneJson(ownerPathFor(lockDir), {
          ...owner,
          updatedAt: now.toISOString(),
          leaseExpiresAt: new Date(now.getTime() + lockLeaseMs()).toISOString(),
        } satisfies LockOwner);
      } catch {
        clearInterval(heartbeat);
      }
    },
    Math.max(250, lockHeartbeatMs()),
  );
  heartbeat.unref?.();
  return {
    lockScope,
    fencingToken,
    assertCurrentAuthority: async () => {
      const owner = await readLockOwner(lockDir);
      if (!sameOwner(owner, holderId, fencingToken) || leaseExpired(owner)) {
        throw Object.assign(
          new Error(`shared control-plane lock authority lost for ${lockScope}`),
          { code: "lock_authority_lost" },
        );
      }
    },
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      const owner = await readLockOwner(lockDir);
      if (sameOwner(owner, holderId, fencingToken)) {
        await fsp.rm(lockDir, { recursive: true, force: true });
      }
    },
  };
}
