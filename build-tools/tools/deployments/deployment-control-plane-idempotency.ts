#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { DeploymentIdempotencyConflictError } from "./deployment-control-plane-errors";
import {
  readControlPlaneJson,
  submitIdempotencyPathFor,
  writeControlPlaneJson,
  runActionIdempotencyPathFor,
} from "./nixos-shared-host-control-plane-store";

export const DEPLOYMENT_CONTROL_PLANE_IDEMPOTENCY_SCHEMA = "deployment-control-plane-idempotency@1";

type IdempotencyEntry = {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_IDEMPOTENCY_SCHEMA;
  kind: "submit" | "run-action";
  idempotencyKey: string;
  requestFingerprint: string;
  targetId: string;
  createdAt: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function fingerprintControlPlanePayload(value: unknown): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

export function directControlPlaneDedupe(targetId: string) {
  return {
    mode: "created" as const,
    requestFingerprint: `direct:${targetId}`,
  };
}

async function resolveIdempotency(opts: {
  recordsRoot: string;
  kind: IdempotencyEntry["kind"];
  idempotencyKey?: string;
  requestFingerprint: string;
  targetId: string;
}): Promise<{ mode: "created" | "reused"; idempotencyKey?: string; targetId: string }> {
  if (!opts.idempotencyKey) return { mode: "created", targetId: opts.targetId };
  const entryPath =
    opts.kind === "submit"
      ? submitIdempotencyPathFor(opts.recordsRoot, opts.idempotencyKey)
      : runActionIdempotencyPathFor(opts.recordsRoot, opts.idempotencyKey);
  let existing: IdempotencyEntry | undefined;
  try {
    existing = await readControlPlaneJson<IdempotencyEntry>(entryPath);
  } catch {
    existing = undefined;
  }
  if (existing) {
    if (existing.requestFingerprint !== opts.requestFingerprint) {
      throw new DeploymentIdempotencyConflictError(
        `${opts.kind} idempotency key ${opts.idempotencyKey} does not match the previous request`,
      );
    }
    return {
      mode: "reused",
      idempotencyKey: existing.idempotencyKey,
      targetId: existing.targetId,
    };
  }
  await writeControlPlaneJson(entryPath, {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_IDEMPOTENCY_SCHEMA,
    kind: opts.kind,
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint: opts.requestFingerprint,
    targetId: opts.targetId,
    createdAt: new Date().toISOString(),
  } satisfies IdempotencyEntry);
  return {
    mode: "created",
    idempotencyKey: opts.idempotencyKey,
    targetId: opts.targetId,
  };
}

export async function resolveSubmitIdempotency(opts: {
  recordsRoot: string;
  idempotencyKey?: string;
  requestFingerprint: string;
  submissionId: string;
}) {
  return await resolveIdempotency({
    recordsRoot: opts.recordsRoot,
    kind: "submit",
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint: opts.requestFingerprint,
    targetId: opts.submissionId,
  });
}

export async function resolveRunActionIdempotency(opts: {
  recordsRoot: string;
  idempotencyKey?: string;
  requestFingerprint: string;
  actionId: string;
}) {
  return await resolveIdempotency({
    recordsRoot: opts.recordsRoot,
    kind: "run-action",
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint: opts.requestFingerprint,
    targetId: opts.actionId,
  });
}
