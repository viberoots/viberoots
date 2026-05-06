#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  resolvePromotionS3StaticAdmittedContext,
  resolveSourceRunS3StaticAdmittedContext,
} from "./s3-static-admission";
import { prepareS3StaticPublisherConfig } from "./s3-static-config";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts";
import { requireAdmittedStaticWebappArtifactPath } from "./static-webapp-artifacts";
import type { S3StaticDeployment } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import type { S3StaticAdmittedContext } from "./s3-static-admission";
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy";
import {
  classifySmokeRetry,
  noPublishAutoRetry,
  runWithAutomaticRetry,
} from "./deployment-retry-policy";
import { publishS3StaticWebapp } from "./s3-static-publisher";
import { createS3StaticDeployRecord, writeS3StaticDeployRecord } from "./s3-static-records";
import { writeS3StaticReplaySnapshot } from "./s3-static-replay";
import { smokeS3StaticWebapp } from "./s3-static-smoke";

type SourceRecordLike = { deployRunId: string; deploymentId: string; admittedContext?: any };

export async function submitS3StaticExactArtifactRun(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  recordsRoot: string;
  operationKind: "promotion" | "retry" | "rollback";
  artifact: AdmittedStaticWebappArtifact;
  sourceRecord: SourceRecordLike;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  submissionId?: string;
  expectedSourceRevision?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  admittedContext?: S3StaticAdmittedContext;
  smokeConnectOverride?: { protocol: "http:" | "https:"; hostname: string; port: number };
}) {
  const admittedContext = opts.admittedContext || (await resolveAdmittedContext(opts));
  admittedContext.policyEvaluation =
    admittedContext.policyEvaluation ||
    (await evaluateDeploymentAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      operationKind: opts.operationKind,
      admittedContext,
      sourceRecord: opts.sourceRecord as any,
      artifactLineageId: opts.artifactLineageId,
      evidence: opts.admissionEvidence,
    }));
  const deployRunId = `deploy-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const artifactPath = await requireAdmittedStaticWebappArtifactPath(opts.artifact);
  const preparedConfig = await prepareS3StaticPublisherConfig({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    outputPath: path.join(opts.recordsRoot, "provider-config", `${deployRunId}.s3.json`),
  });
  const smokeMode = resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment });
  let executionPolicy: DeploymentExecutionPolicyFacts | undefined;
  try {
    const published = await runWithAutomaticRetry({
      step: "publish",
      run: async () =>
        await publishS3StaticWebapp({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactDir: artifactPath,
          renderedConfigPath: preparedConfig.renderedConfigPath,
        }),
      classifyError: () => noPublishAutoRetry(),
    });
    executionPolicy = { smokeBudget: smokeMode.budget, retries: [published.audit] };
    const smoke = await runWithAutomaticRetry({
      step: "smoke",
      totalBudgetMs: smokeMode.budget.totalBudgetMs,
      run: async () =>
        await smokeS3StaticWebapp({
          deployment: opts.deployment,
          indexPath: path.join(artifactPath, "index.html"),
          connectOverride: opts.smokeConnectOverride,
        }),
      classifyError: classifySmokeRetry,
    });
    executionPolicy.retries.push(smoke.audit);
    const replaySnapshotPath = await writeS3StaticReplaySnapshot({
      recordsRoot: opts.recordsRoot,
      deployRunId,
      deployment: opts.deployment,
      artifact: opts.artifact,
      admittedContext,
      providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
    });
    const record = createS3StaticDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: opts.operationKind,
      runClassification: opts.operationKind,
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      parentRunId: opts.parentRunId,
      releaseLineageId: opts.releaseLineageId,
      artifactLineageId: opts.artifactLineageId,
      artifact: opts.artifact,
      admittedContext,
      smokeOutcome: "passed",
      executionPolicy,
      deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
      providerConfigFingerprint: preparedConfig.fingerprint,
      replaySnapshotPath,
      publicUrl: smoke.result.publicUrl,
      ...(published.result.providerReleaseId
        ? { providerReleaseId: published.result.providerReleaseId }
        : {}),
    });
    return { record, recordPath: await writeS3StaticDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const record = createS3StaticDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: opts.operationKind,
      runClassification: opts.operationKind,
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome:
        (error as any)?.retryAudit?.step === "smoke"
          ? "smoke_failed_after_publish"
          : "publish_failed",
      parentRunId: opts.parentRunId,
      releaseLineageId: opts.releaseLineageId,
      artifactLineageId: opts.artifactLineageId,
      artifact: opts.artifact,
      admittedContext,
      executionPolicy,
      deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
      providerConfigFingerprint: preparedConfig.fingerprint,
      failedStep: (error as any)?.retryAudit?.step === "smoke" ? "smoke" : "publish",
      error: error instanceof Error ? error.message : String(error),
    });
    const recordPath = await writeS3StaticDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      record,
      recordPath,
    });
  }
}

async function resolveAdmittedContext(opts: Parameters<typeof submitS3StaticExactArtifactRun>[0]) {
  const common = {
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: opts.artifact.identity,
    sourceRecord: opts.sourceRecord,
    ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
    ...(opts.expectedSourceRevision ? { expectedSourceRevision: opts.expectedSourceRevision } : {}),
  };
  return opts.operationKind === "promotion"
    ? await resolvePromotionS3StaticAdmittedContext(common)
    : await resolveSourceRunS3StaticAdmittedContext(common);
}
