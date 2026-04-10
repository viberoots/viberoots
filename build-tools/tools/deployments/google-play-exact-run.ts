#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  resolvePromotionGooglePlayAdmittedContext,
  resolveSourceRunGooglePlayAdmittedContext,
} from "./google-play-admission.ts";
import { prepareGooglePlayPublisherConfig } from "./google-play-config.ts";
import type { AdmittedGooglePlayArtifact } from "./google-play-artifacts.ts";
import type { GooglePlayDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import { publishRecordedGooglePlayArtifact } from "./google-play-deploy.ts";

type SourceRecordLike = { deployRunId: string; deploymentId: string; admittedContext?: any };

export async function submitGooglePlayExactArtifactRun(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  recordsRoot: string;
  operationKind: "promotion" | "retry" | "rollback";
  artifact: AdmittedGooglePlayArtifact;
  sourceRecord: SourceRecordLike;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  sourceTrack?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const admittedContext =
    opts.operationKind === "promotion"
      ? await resolvePromotionGooglePlayAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactIdentity: opts.artifact.identity,
          sourceRecord: opts.sourceRecord,
        })
      : await resolveSourceRunGooglePlayAdmittedContext({
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
  const preparedConfig = await prepareGooglePlayPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(
      opts.recordsRoot,
      "provider-config",
      `${opts.parentRunId}.${opts.operationKind}.google-play.json`,
    ),
  });
  return await publishRecordedGooglePlayArtifact({
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
