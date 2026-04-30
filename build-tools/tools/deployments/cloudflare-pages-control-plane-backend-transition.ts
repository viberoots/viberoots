#!/usr/bin/env zx-wrapper
import type { CloudflarePagesControlPlaneSnapshot } from "./cloudflare-pages-control-plane-contract.ts";
import { createCloudflarePagesDeployRunId } from "./cloudflare-pages-records.ts";
import {
  writeTransitionRecord,
  type CloudflarePagesTargetTransitionRecord,
} from "./cloudflare-pages-target-transition-records.ts";
import type { CloudflareBackendSubmissionLike } from "./cloudflare-pages-control-plane-backend-status.ts";

export async function executeCloudflarePagesBackendTargetTransition(opts: {
  recordsRoot: string;
  workerId: string;
  running: CloudflareBackendSubmissionLike;
  snapshot: CloudflarePagesControlPlaneSnapshot;
}) {
  if (!opts.snapshot.targetException) {
    throw new Error("cloudflare-pages target transition requires targetException");
  }
  const targetException = opts.snapshot.targetException;
  const record: CloudflarePagesTargetTransitionRecord = {
    schemaVersion: "cloudflare-pages-target-transition-record@1",
    deployRunId: createCloudflarePagesDeployRunId("transition"),
    operationKind: opts.snapshot.operationKind,
    runClassification: opts.snapshot.operationKind,
    finalOutcome: "succeeded",
    deploymentId: opts.snapshot.deployment.deploymentId,
    deploymentLabel: opts.snapshot.deployment.label,
    provider: "cloudflare-pages",
    providerTargetIdentity: opts.snapshot.deployment.providerTarget.providerTargetIdentity,
    oldProviderTargetIdentity: targetException.oldProviderTargetIdentity,
    ...(targetException.newProviderTargetIdentity
      ? { newProviderTargetIdentity: targetException.newProviderTargetIdentity }
      : {}),
    sharedLockScope: targetException.sharedLockScope,
    requestedBy: opts.running.requestedBy || { principalId: "service" },
    authorization: opts.running.authorization as any,
    targetException,
    resultingOwnershipState:
      opts.snapshot.operationKind === "retire_target"
        ? { kind: "retired", ownerDeploymentId: null }
        : {
            kind: "migrated",
            ownerDeploymentId: opts.snapshot.deployment.deploymentId,
            providerTargetIdentity: opts.snapshot.deployment.providerTarget.providerTargetIdentity,
          },
    controlPlane: {
      submissionId: opts.snapshot.submissionId,
      submissionPath: "",
      executionSnapshotPath: "",
      lockScope: opts.snapshot.lockScope,
      workerId: opts.workerId,
    },
  };
  return {
    record,
    recordPath: await writeTransitionRecord(opts.recordsRoot, record),
  };
}
