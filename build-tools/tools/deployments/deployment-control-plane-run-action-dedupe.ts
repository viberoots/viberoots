#!/usr/bin/env zx-wrapper
import { randomUUID } from "node:crypto";
import { resolveRunActionIdempotency } from "./deployment-control-plane-idempotency";
import {
  resolveBackendIdempotency,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";

export async function resolveDurableRunActionDedupe(opts: {
  recordsRoot: string;
  backend?: NixosSharedHostControlPlaneBackendTarget;
  idempotencyKey?: string;
  requestFingerprint: string;
}) {
  const actionCandidateId = randomUUID();
  return opts.backend
    ? await resolveBackendIdempotency({
        backend: opts.backend,
        kind: "run_action",
        key: opts.idempotencyKey || actionCandidateId,
        requestFingerprint: opts.requestFingerprint,
        targetId: actionCandidateId,
      })
    : await resolveRunActionIdempotency({
        recordsRoot: opts.recordsRoot,
        idempotencyKey: opts.idempotencyKey,
        requestFingerprint: opts.requestFingerprint,
        actionId: actionCandidateId,
      });
}
