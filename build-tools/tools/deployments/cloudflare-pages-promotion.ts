#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  resolveCrossDeploymentPromotionSelection,
  resolveCrossDeploymentPromotionSourceSelection,
  type CrossDeploymentPromotionSelection,
} from "./deployment-promotion.ts";
import { submitCloudflarePagesControlPlaneDeploy } from "./cloudflare-pages-control-plane.ts";
import type { CloudflarePagesSmokeConnectOverride } from "./cloudflare-pages-control-plane-contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";

export async function resolveCloudflarePagesPromotionSelection(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  sourceRunId: string;
}): Promise<CrossDeploymentPromotionSelection<CloudflarePagesDeployment>> {
  return await resolveCrossDeploymentPromotionSelection(opts);
}

export async function submitCloudflarePagesRebuildPerStagePromotion(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactDir: string;
  recordsRoot: string;
  sourceRunId: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
}) {
  if (opts.deployment.lanePolicy.artifactReuseMode !== "rebuild_per_stage") {
    throw new Error(
      `cloudflare-pages source-run promotion without --publish-only requires artifact_reuse_mode rebuild_per_stage, got ${opts.deployment.lanePolicy.artifactReuseMode}`,
    );
  }
  const promotion = await resolveCrossDeploymentPromotionSourceSelection(opts);
  return await submitCloudflarePagesControlPlaneDeploy({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot: opts.recordsRoot,
    artifactDir: opts.artifactDir,
    operationKind: promotion.operationKind,
    parentRunId: promotion.parentRunId,
    releaseLineageId: promotion.releaseLineageId,
    source: {
      record: promotion.sourceRecord,
      recordPath: promotion.sourceRecordPath,
      replaySnapshotPath: promotion.sourceReplaySnapshotPath,
    },
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  });
}
