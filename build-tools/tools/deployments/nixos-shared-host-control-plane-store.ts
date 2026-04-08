#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { sanitizeName } from "../lib/sanitize.ts";
import { assertNoBreakGlassFreeze } from "./nixos-shared-host-break-glass-freeze.ts";

type LockOwner = { pid: number; createdAt: string; lockScope: string };

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
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function readControlPlaneJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fsp.readFile(filePath, "utf8")) as T;
}

function lockDirFor(recordsRoot: string, lockScope: string): string {
  return path.join(controlPlaneRoot(recordsRoot), "locks", `${sanitizeName(lockScope)}.lock`);
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
    return await readControlPlaneJson<LockOwner>(path.join(lockDir, "owner.json"));
  } catch {
    return null;
  }
}

export async function acquireControlPlaneLock(
  recordsRoot: string,
  lockScope: string,
): Promise<() => Promise<void>> {
  await assertNoBreakGlassFreeze(recordsRoot, lockScope);
  const lockDir = lockDirFor(recordsRoot, lockScope);
  await fsp.mkdir(path.dirname(lockDir), { recursive: true });
  const tryAcquire = async (): Promise<boolean> => {
    try {
      await fsp.mkdir(lockDir);
      return true;
    } catch {
      return false;
    }
  };
  if (!(await tryAcquire())) {
    const owner = await readLockOwner(lockDir);
    if (!owner || !pidAlive(owner.pid)) {
      await fsp.rm(lockDir, { recursive: true, force: true });
      if (!(await tryAcquire())) {
        throw new Error(`shared control-plane lock conflict for ${lockScope}`);
      }
    } else {
      throw new Error(`shared control-plane lock conflict for ${lockScope}`);
    }
  }
  await writeControlPlaneJson(path.join(lockDir, "owner.json"), {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    lockScope,
  } satisfies LockOwner);
  return async () => {
    await fsp.rm(lockDir, { recursive: true, force: true });
  };
}
