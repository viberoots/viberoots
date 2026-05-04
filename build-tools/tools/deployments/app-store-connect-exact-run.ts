#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  resolvePromotionAppStoreConnectAdmittedContext,
  resolveSourceRunAppStoreConnectAdmittedContext,
} from "./app-store-connect-admission";
import { prepareAppStoreConnectPublisherConfig } from "./app-store-connect-config";
import type { AdmittedMobileAppArtifact } from "./app-store-connect-artifacts";
import type { AppStoreConnectDeployment } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import { publishRecordedAppStoreConnectArtifact } from "./app-store-connect-deploy";

type SourceRecordLike = { deployRunId: string; deploymentId: string; admittedContext?: any };

export async function submitAppStoreConnectExactArtifactRun(opts: {
  workspaceRoot: string;
  deployment: AppStoreConnectDeployment;
  recordsRoot: string;
  operationKind: "promotion" | "retry" | "rollback";
  artifact: AdmittedMobileAppArtifact;
  sourceRecord: SourceRecordLike;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  sourceTrack?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const admittedContext =
    opts.operationKind === "promotion"
      ? await resolvePromotionAppStoreConnectAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactIdentity: opts.artifact.identity,
          sourceRecord: opts.sourceRecord,
        })
      : await resolveSourceRunAppStoreConnectAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactIdentity: opts.artifact.identity,
          sourceRecord: opts.sourceRecord,
        });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    admittedContext,
    sourceRecord: opts.sourceRecord as any,
    artifactLineageId: opts.artifactLineageId,
    evidence: opts.admissionEvidence,
  });
  const preparedConfig = await prepareAppStoreConnectPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(
      opts.recordsRoot,
      "provider-config",
      `${opts.parentRunId}.${opts.operationKind}.asc.json`,
    ),
  });
  return await publishRecordedAppStoreConnectArtifact({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot: opts.recordsRoot,
    operationKind: opts.operationKind,
    artifact: opts.artifact,
    admittedContext,
    parentRunId: opts.parentRunId,
    releaseLineageId: opts.releaseLineageId,
    artifactLineageId: opts.artifactLineageId,
    sourceTrack: opts.sourceTrack,
    providerConfigFingerprint: preparedConfig.fingerprint,
    providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
  });
}
