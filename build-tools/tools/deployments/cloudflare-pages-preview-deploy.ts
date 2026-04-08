#!/usr/bin/env zx-wrapper
import { resolveSourceRunCloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesSmokeConnectOverride,
} from "./cloudflare-pages-control-plane-contract.ts";
import {
  createCloudflarePagesSubmissionId,
  withCloudflarePagesControlPlaneRun,
} from "./cloudflare-pages-control-plane-shared.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import {
  deriveCloudflarePagesPreviewTarget,
  cloudflarePagesPreviewIdentitySelector,
} from "./cloudflare-pages-preview.ts";
import { resolveCloudflarePagesPreviewSelection } from "./cloudflare-pages-preview-source.ts";
import { runCloudflarePagesStaticDeploy } from "./cloudflare-pages-static-deploy.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";

export async function submitCloudflarePagesPreviewDeploy(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  sourceRunId: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
}) {
  const effectiveRunTarget = deriveCloudflarePagesPreviewTarget(opts.deployment, opts.sourceRunId);
  const source = await resolveCloudflarePagesPreviewSelection({
    deployment: opts.deployment,
    recordsRoot: opts.recordsRoot,
    sourceRunId: opts.sourceRunId,
  });
  const submissionId = createCloudflarePagesSubmissionId();
  const admittedContext = await resolveSourceRunCloudflarePagesAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: source.artifact.identity,
    sourceRecord: source.sourceRecord,
  });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: "preview",
    admittedContext,
    sourceRecord: source.sourceRecord,
    artifactLineageId: source.artifactLineageId,
    evidence: opts.admissionEvidence,
  });
  const snapshot: CloudflarePagesControlPlaneSnapshot = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt: new Date().toISOString(),
    operationKind: "deploy",
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: effectiveRunTarget.providerTargetIdentity,
    lockScope: opts.deployment.providerTarget.providerTargetIdentity,
    deployment: opts.deployment,
    admittedContext,
    paths: { workspaceRoot: opts.workspaceRoot, recordsRoot: opts.recordsRoot },
    action: {
      kind: "deploy",
      publishBehavior: "deploy",
      publishMode: "preview",
      effectiveRunTarget,
      previewIdentitySelector: cloudflarePagesPreviewIdentitySelector(opts.sourceRunId),
      publishInput: { kind: "exact-artifact", artifact: source.artifact },
      parentRunId: source.parentRunId,
      releaseLineageId: source.releaseLineageId,
      artifactLineageId: source.artifactLineageId,
      sourceRecordPath: source.sourceRecordPath,
      sourceReplaySnapshotPath: source.sourceReplaySnapshotPath,
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
        artifact: source.artifact,
        recordsRoot: opts.recordsRoot,
        operationKind: "deploy",
        admittedContext,
        parentRunId: source.parentRunId,
        releaseLineageId: source.releaseLineageId,
        artifactLineageId: source.artifactLineageId,
        authority,
        publishMode: "preview",
        effectiveRunTarget,
        previewIdentitySelector: cloudflarePagesPreviewIdentitySelector(opts.sourceRunId),
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
