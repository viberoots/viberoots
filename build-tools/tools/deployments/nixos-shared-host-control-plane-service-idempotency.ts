#!/usr/bin/env zx-wrapper
import { submitResponseFromSubmission } from "./deployment-control-plane-status.ts";
import {
  readBackendSubmissionBySubmissionId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";

export async function reusedBackendSubmitResponse(
  backend: NixosSharedHostControlPlaneBackendTarget,
  targetId: string,
) {
  const existing = await readBackendSubmissionBySubmissionId(backend, targetId);
  if (!existing) throw new Error(`idempotent submission missing backend state: ${targetId}`);
  return submitResponseFromSubmission(existing as any);
}
