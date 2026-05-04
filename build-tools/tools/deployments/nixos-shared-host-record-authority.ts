#!/usr/bin/env zx-wrapper
import type { NixosSharedHostMutationAuthority } from "./nixos-shared-host-control-plane-contract";

export function recordAuthorityFields(authority?: NixosSharedHostMutationAuthority) {
  if (authority?.kind === "control-plane-worker") {
    return {
      controlPlane: {
        submissionId: authority.submissionId,
        workerId: authority.workerId,
        admission: "admitted" as const,
        lockScope: authority.lockScope,
      },
    };
  }
  if (authority?.kind === "break-glass-worker") {
    return {
      breakGlass: {
        incidentRef: authority.incidentRef,
        freezeId: authority.freezeId,
        freezePath: authority.freezePath,
        evidencePath: authority.evidencePath,
        requestedBy: authority.requestedBy,
        ...(authority.approvedBy ? { approvedBy: authority.approvedBy } : {}),
        executedBy: authority.executedBy,
        justification: authority.justification,
        bypassReason: authority.bypassReason,
        selection: authority.selection,
      },
    };
  }
  if (authority?.kind === "bootstrap-worker") {
    return {
      bootstrap: {
        mode: authority.mode,
        evidencePath: authority.evidencePath,
        executionSnapshotPath: authority.executionSnapshotPath,
        lockScope: authority.lockScope,
        requestedBy: authority.requestedBy,
        executedBy: authority.executedBy,
        ownershipProof: authority.ownershipProof,
        targetIdentityProof: authority.targetIdentityProof,
        selection: authority.selection,
        reconciliation: { status: "pending" as const },
      },
    };
  }
  return {};
}
