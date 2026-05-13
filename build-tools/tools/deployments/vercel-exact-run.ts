#!/usr/bin/env zx-wrapper
import type { VercelDeployment } from "./contract";
import { createDeploymentSecretRuntimeForAdmittedContext } from "./deployment-secret-runtime-helpers";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy";
import type { VercelApiClient } from "./vercel-api";
import { createFakeVercelApiClient, createLiveVercelApiClient } from "./vercel-api";
import {
  createVercelDeployRecord,
  createVercelDeployRunId,
  writeVercelDeployRecord,
  type VercelDeployRecord,
  type VercelOperationKind,
} from "./vercel-records";
import { vercelFailureErrorFields } from "./vercel-record-diagnostics";
import { writeVercelReplaySnapshot, type VercelReplaySnapshot } from "./vercel-replay";
import { smokeVercelConsole, type VercelSmokeConnectOverride } from "./vercel-smoke";
import type { VercelAdmittedContext } from "./vercel-admission";

type ExactArtifactRunOperation = "retry" | "rollback" | "promotion";

function configuredAlias(deployment: VercelDeployment): string[] {
  if (deployment.providerTarget.environment === "preview") return [];
  try {
    return [new URL(deployment.providerTarget.canonicalUrl).hostname].filter(Boolean);
  } catch {
    return [];
  }
}

function failureOutcome(error: unknown): VercelDeployRecord["finalOutcome"] {
  const message = error instanceof Error ? error.message : String(error);
  const outcome = (error as any)?.outcome;
  if (outcome === "pending") return "pending";
  if (outcome === "ambiguous") return "ambiguous";
  return /smoke/.test(message) ? "smoke_failed_after_publish" : "publish_failed";
}

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
  let secrets: string[] = [];
  try {
    const secretRuntime = createDeploymentSecretRuntimeForAdmittedContext({
      admittedContext: opts.admittedContext || {
        secretRequirements: opts.deployment.secretRequirements,
        secretBackend: opts.deployment.secretBackend || "vault",
        targetEnvironment: {
          lockScope: opts.deployment.providerTarget.providerTargetIdentity,
        },
      },
      defaultBackend: opts.deployment.secretBackend || "vault",
      fallbackTargetScope: opts.deployment.providerTarget.providerTargetIdentity,
    });
    const publishSecrets = await secretRuntime.enterStep("publish");
    if (!String(publishSecrets.vercel_api_token || "").trim()) {
      throw new Error("vercel exact-artifact run requires a secret-runtime API token");
    }
    const apiToken = String(publishSecrets.vercel_api_token);
    secrets = [apiToken];
    const apiClient =
      opts.apiClient ||
      (opts.deployment.protectionClass === "local_only"
        ? createFakeVercelApiClient()
        : createLiveVercelApiClient({ apiToken }));
    const target = opts.deployment.providerTarget;
    const published = await apiClient.publishPrebuilt({
      team: target.team,
      project: target.project,
      environment: target.environment,
      artifactIdentity: opts.replaySnapshot.artifact.identity,
      outputDir: String(opts.replaySnapshot.artifact.outputDir || ""),
      sourceRunId: opts.parentRunId,
      aliases: configuredAlias(opts.deployment),
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
      finalOutcome: failureOutcome(error),
      artifact: opts.replaySnapshot.artifact,
      parentRunId: opts.parentRunId,
      releaseLineageId: opts.releaseLineageId,
      artifactLineageId: opts.artifactLineageId,
      ...((error as any)?.providerReleaseId
        ? { providerReleaseId: String((error as any).providerReleaseId) }
        : {}),
      ...((error as any)?.publicUrl ? { publicUrl: String((error as any).publicUrl) } : {}),
      ...vercelFailureErrorFields(error, { secrets }),
    });
    const recordPath = await writeVercelDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
