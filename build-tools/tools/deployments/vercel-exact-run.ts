#!/usr/bin/env zx-wrapper
import type { VercelDeployment } from "./contract";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy";
import type { VercelApiClient } from "./vercel-api";
import { createFakeVercelApiClient } from "./vercel-api";
import {
  createVercelDeployRecord,
  createVercelDeployRunId,
  writeVercelDeployRecord,
  type VercelDeployRecord,
  type VercelOperationKind,
} from "./vercel-records";
import { writeVercelReplaySnapshot, type VercelReplaySnapshot } from "./vercel-replay";
import { smokeVercelConsole, type VercelSmokeConnectOverride } from "./vercel-smoke";
import type { VercelAdmittedContext } from "./vercel-admission";

type ExactArtifactRunOperation = "retry" | "rollback" | "promotion";

export async function submitVercelExactArtifactRun(opts: {
  deployment: VercelDeployment;
  recordsRoot: string;
  operationKind: ExactArtifactRunOperation;
  replaySnapshot: VercelReplaySnapshot;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  apiClient?: VercelApiClient;
  admittedContext?: VercelAdmittedContext;
  smokeConnectOverride?: VercelSmokeConnectOverride;
}): Promise<{ record: VercelDeployRecord; recordPath: string }> {
  const runId = createVercelDeployRunId(`vercel-${opts.operationKind}`);
  try {
    const secretRuntime = createVaultDeploymentSecretRuntime({
      admittedContext: opts.admittedContext || {
        secretRequirements: opts.deployment.secretRequirements,
        targetEnvironment: {
          lockScope: opts.deployment.providerTarget.providerTargetIdentity,
        },
      },
      fallbackTargetScope: opts.deployment.providerTarget.providerTargetIdentity,
    });
    const publishSecrets = await secretRuntime.enterStep("publish");
    if (!String(publishSecrets.vercel_api_token || "").trim()) {
      throw new Error("vercel exact-artifact run requires a secret-runtime API token");
    }
    const apiClient = opts.apiClient || createFakeVercelApiClient();
    const target = opts.deployment.providerTarget;
    const published = await apiClient.publishPrebuilt({
      team: target.team,
      project: target.project,
      environment: target.environment,
      artifactIdentity: opts.replaySnapshot.artifact.identity,
      outputDir: String(opts.replaySnapshot.artifact.outputDir || ""),
      sourceRunId: opts.parentRunId,
    });
    if (!published.deploymentId.trim()) {
      throw new Error("vercel exact-artifact run rejected ambiguous publish outcome");
    }
    const smokeMode = resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment });
    let smokeOutcome: VercelDeployRecord["smokeOutcome"] = "passed";
    if (smokeMode.mode === "omitted") {
      smokeOutcome = "omitted_by_exception";
    } else {
      await secretRuntime.enterStep("smoke");
      await smokeVercelConsole({
        deployment: opts.deployment,
        publicUrl: published.url || opts.replaySnapshot.publicUrl,
        ...(opts.smokeConnectOverride ? { connectOverride: opts.smokeConnectOverride } : {}),
      });
    }
    const replaySnapshotPath = await writeVercelReplaySnapshot({
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      deployment: opts.deployment,
      artifact: opts.replaySnapshot.artifact,
      providerReleaseId: published.deploymentId,
      publicUrl: published.url || opts.replaySnapshot.publicUrl,
      aliasAssigned: published.aliasAssigned,
      providerConfigFingerprint: opts.replaySnapshot.providerConfigFingerprint,
      admittedContext: opts.admittedContext as any,
    });
    const record = createVercelDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind: opts.operationKind as VercelOperationKind,
      runClassification: opts.operationKind as VercelOperationKind,
      finalOutcome: "succeeded",
      artifact: opts.replaySnapshot.artifact,
      parentRunId: opts.parentRunId,
      releaseLineageId: opts.releaseLineageId,
      artifactLineageId: opts.artifactLineageId,
      publicUrl: published.url || opts.replaySnapshot.publicUrl,
      providerReleaseId: published.deploymentId,
      aliasAssigned: published.aliasAssigned,
      smokeOutcome,
      providerConfigFingerprint: opts.replaySnapshot.providerConfigFingerprint,
      replaySnapshotPath,
      ...(opts.admittedContext ? { admittedContext: opts.admittedContext as any } : {}),
    });
    return { record, recordPath: await writeVercelDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const record = createVercelDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind: opts.operationKind as VercelOperationKind,
      runClassification: opts.operationKind as VercelOperationKind,
      finalOutcome: /smoke/.test(message) ? "smoke_failed_after_publish" : "publish_failed",
      artifact: opts.replaySnapshot.artifact,
      parentRunId: opts.parentRunId,
      releaseLineageId: opts.releaseLineageId,
      artifactLineageId: opts.artifactLineageId,
      error: message,
    });
    const recordPath = await writeVercelDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
