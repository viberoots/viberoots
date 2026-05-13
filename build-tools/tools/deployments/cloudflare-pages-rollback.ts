#!/usr/bin/env zx-wrapper
import { resolveSourceRunCloudflarePagesAdmittedContext } from "./cloudflare-pages-admission";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesSmokeConnectOverride,
} from "./cloudflare-pages-control-plane-contract";
import {
  createCloudflarePagesSubmissionId,
  withCloudflarePagesControlPlaneRun,
} from "./cloudflare-pages-control-plane-shared";
import { runCloudflarePagesStaticDeploy } from "./cloudflare-pages-static-deploy";
import type { CloudflarePagesDeployment } from "./contract";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { rollbackStageStateErrors } from "./deployment-rollback-candidates";
import { invalidatingTargetException } from "./deployment-target-exceptions";
import { resolveCloudflarePagesReplaySource } from "./cloudflare-pages-replay";

function sameDeploymentRollbackErrors(
  current: CloudflarePagesDeployment,
  sourceDeployment: CloudflarePagesDeployment,
): string[] {
  const errors: string[] = [];
  const currentTargetIdentity = current.providerTarget.providerTargetIdentity;
  const sourceTargetIdentity = sourceDeployment.providerTarget.providerTargetIdentity;
  const invalidatingException = invalidatingTargetException(
    current.targetExceptions,
    sourceTargetIdentity,
    currentTargetIdentity,
  );
  if (sourceDeployment.deploymentId !== current.deploymentId) {
    errors.push(
      `rollback source run must belong to ${current.deploymentId}, got ${sourceDeployment.deploymentId}`,
    );
  }
  if (sourceDeployment.component.kind !== current.component.kind) {
    errors.push(
      `component kind mismatch: current=${current.component.kind} source=${sourceDeployment.component.kind}`,
    );
  }
  if (sourceDeployment.component.target !== current.component.target) {
    errors.push(
      `component target mismatch: current=${current.component.target} source=${sourceDeployment.component.target}`,
    );
  }
  if (sourceTargetIdentity !== currentTargetIdentity) {
    errors.push(
      invalidatingException
        ? `recorded target binding ${sourceTargetIdentity} was invalidated by ${invalidatingException.ref}`
        : `provider target mismatch: current=${currentTargetIdentity} source=${sourceTargetIdentity}`,
    );
  }
  return errors;
}

function rollbackSourceEligibilityErrors(
  deployment: CloudflarePagesDeployment,
  record: {
    deployRunId: string;
    finalOutcome: string;
    runClassification: string;
    publishMode: string;
    effectiveRunTarget: { providerTargetIdentity: string };
  },
): string[] {
  const errors: string[] = [];
  if (record.finalOutcome !== "succeeded") {
    errors.push(`source run is not successful: ${record.finalOutcome}`);
  }
  if (record.runClassification !== "deploy" && record.runClassification !== "promotion") {
    errors.push(`wrong run classification: ${record.runClassification}`);
  }
  if (record.publishMode !== "normal") {
    errors.push(`rollback source must use publish_mode normal, got ${record.publishMode}`);
  }
  if (
    record.effectiveRunTarget.providerTargetIdentity !==
    deployment.providerTarget.providerTargetIdentity
  ) {
    errors.push("selected source run refers to preview rather than the normal live target");
  }
  return errors;
}

export async function resolveCloudflarePagesRollbackSelection(opts: {
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  sourceRunId: string;
  backendDatabaseUrl?: string;
}) {
  const source = await resolveCloudflarePagesReplaySource({
    recordsRoot: opts.recordsRoot,
    deployRunId: opts.sourceRunId,
    ...(opts.backendDatabaseUrl ? { backendDatabaseUrl: opts.backendDatabaseUrl } : {}),
  });
  const errors = [
    ...sameDeploymentRollbackErrors(opts.deployment, source.replaySnapshot.deployment),
    ...rollbackSourceEligibilityErrors(opts.deployment, source.record),
  ];
  if (!opts.backendDatabaseUrl) {
    errors.push(
      "cloudflare-pages rollback requires backendDatabaseUrl or --control-plane-database-url for current stage state",
    );
  } else {
    errors.push(
      ...(await rollbackStageStateErrors({
        backend: {
          recordsRoot: opts.recordsRoot,
          databaseUrl: opts.backendDatabaseUrl,
        },
        deployment: opts.deployment,
        sourceRunId: source.record.deployRunId,
      })),
    );
  }
  if (errors.length > 0) {
    throw new Error(`rollback source run is not eligible: ${source.record.deployRunId}
${errors.join("\n")}`);
  }
  return {
    artifact: source.replaySnapshot.artifact,
    parentRunId: source.record.deployRunId,
    releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
    artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
    sourceRecordPath: source.recordPath,
    sourceReplaySnapshotPath: source.record.replaySnapshotPath || "",
    sourceRecord: source.record,
  };
}

export async function submitCloudflarePagesRollback(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  sourceRunId: string;
  backendDatabaseUrl?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
}) {
  const selection = await resolveCloudflarePagesRollbackSelection(opts);
  const submissionId = createCloudflarePagesSubmissionId();
  const admittedContext = await resolveSourceRunCloudflarePagesAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: selection.artifact.identity,
    sourceRecord: selection.sourceRecord,
  });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: "rollback",
    admittedContext,
    sourceRecord: selection.sourceRecord,
    artifactLineageId: selection.artifactLineageId,
    evidence: opts.admissionEvidence,
  });
  const snapshot: CloudflarePagesControlPlaneSnapshot = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt: new Date().toISOString(),
    operationKind: "rollback",
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    lockScope: opts.deployment.providerTarget.providerTargetIdentity,
    deployment: opts.deployment,
    admittedContext,
    paths: { workspaceRoot: opts.workspaceRoot, recordsRoot: opts.recordsRoot },
    action: {
      kind: "deploy",
      publishBehavior: "publish-only",
      publishInput: { kind: "exact-artifact", artifact: selection.artifact },
      parentRunId: selection.parentRunId,
      releaseLineageId: selection.releaseLineageId,
      artifactLineageId: selection.artifactLineageId,
      sourceRecordPath: selection.sourceRecordPath,
      sourceReplaySnapshotPath: selection.sourceReplaySnapshotPath,
    },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
  return await withCloudflarePagesControlPlaneRun(
    opts.deployment,
    opts.recordsRoot,
    snapshot,
    async (authority) =>
      await runCloudflarePagesStaticDeploy({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        artifact: selection.artifact,
        recordsRoot: opts.recordsRoot,
        operationKind: "rollback",
        admittedContext,
        parentRunId: selection.parentRunId,
        releaseLineageId: selection.releaseLineageId,
        artifactLineageId: selection.artifactLineageId,
        authority,
        ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      }),
    {
      dedupe: {
        mode: "created",
        requestFingerprint: `direct:${submissionId}`,
      },
    },
  );
}
