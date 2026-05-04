#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission";
import type { NixosSharedHostMutationAuthority } from "./nixos-shared-host-control-plane-contract";
import type { NixosSharedHostDeployment } from "./contract";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan";
import {
  createNixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records";
import { staticDeployRecordFields } from "./nixos-shared-host-static-deploy-records";

export async function writeNixosSharedHostProvisionOnlyRecord(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  deployRunId: string;
  operationKind: "provision_only";
  authority: NixosSharedHostMutationAuthority;
  deployBatchId?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactIdentity?: string;
  artifact?: NixosSharedHostAdmittedArtifact;
  artifactLineageId?: string;
  admittedContext?: NixosSharedHostAdmittedContext;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  deploymentMetadataFingerprint?: string;
  replaySnapshotPath?: string;
}) {
  const record = createNixosSharedHostDeployRecord(opts.deployment, {
    deployRunId: opts.deployRunId,
    operationKind: opts.operationKind,
    runClassification: opts.operationKind,
    finalOutcome: "succeeded",
    ...staticDeployRecordFields(opts),
    authority: opts.authority,
  });
  return { record, recordPath: await writeNixosSharedHostDeployRecord(opts.recordsRoot, record) };
}

export async function writeNixosSharedHostSuccessRecord(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  deployRunId: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  authority: NixosSharedHostMutationAuthority;
  deployBatchId?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactIdentity?: string;
  artifact?: NixosSharedHostAdmittedArtifact;
  artifactLineageId?: string;
  admittedContext?: NixosSharedHostAdmittedContext;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  deploymentMetadataFingerprint?: string;
  replaySnapshotPath?: string;
  progressiveRollout?: any;
  smokeOutcome?: any;
  smokeException?: any;
  smokeError?: string;
  componentResults: any[];
  publicUrl?: string;
  healthUrl?: string;
}) {
  const record = createNixosSharedHostDeployRecord(opts.deployment, {
    deployRunId: opts.deployRunId,
    operationKind: opts.operationKind,
    runClassification: opts.operationKind,
    finalOutcome: "succeeded",
    ...staticDeployRecordFields(opts),
    ...(opts.smokeOutcome ? { smokeOutcome: opts.smokeOutcome } : {}),
    ...(opts.smokeException ? { smokeException: opts.smokeException } : {}),
    ...(opts.smokeError ? { smokeError: opts.smokeError } : {}),
    componentResults: opts.componentResults,
    publicUrl: opts.publicUrl,
    healthUrl: opts.healthUrl,
    authority: opts.authority,
  });
  return { record, recordPath: await writeNixosSharedHostDeployRecord(opts.recordsRoot, record) };
}
