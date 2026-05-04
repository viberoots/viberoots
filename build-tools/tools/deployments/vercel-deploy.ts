#!/usr/bin/env zx-wrapper
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy";
import type { DeploymentExecutionResult } from "./deployment-execution";
import type { VercelDeployment } from "./contract";
import {
  admitVercelPrebuiltArtifact,
  type AdmittedVercelPrebuiltArtifact,
} from "./vercel-artifacts";
import { publishVercelPrebuilt } from "./vercel-publisher";
import {
  createVercelDeployRecord,
  createVercelDeployRunId,
  writeVercelDeployRecord,
  type VercelDeployRecord,
  type VercelOperationKind,
} from "./vercel-records";
import { smokeVercelConsole, type VercelSmokeConnectOverride } from "./vercel-smoke";
import type { VercelApiClient } from "./vercel-api";
import { cleanupVercelPreview } from "./vercel-publisher";
import { writeVercelReplaySnapshot } from "./vercel-replay";

type VercelDeployResult = { record: VercelDeployRecord; recordPath: string };

async function writeFailure(opts: {
  recordsRoot: string;
  deployment: VercelDeployment;
  runId: string;
  operationKind: VercelOperationKind;
  artifact?: AdmittedVercelPrebuiltArtifact;
  error: unknown;
}): Promise<never> {
  const message = opts.error instanceof Error ? opts.error.message : String(opts.error);
  const record = createVercelDeployRecord(opts.deployment, {
    deployRunId: opts.runId,
    operationKind: opts.operationKind,
    runClassification: opts.operationKind,
    finalOutcome: /smoke/.test(message) ? "smoke_failed_after_publish" : "publish_failed",
    ...(opts.artifact
      ? { artifact: { identity: opts.artifact.identity, outputDir: opts.artifact.outputDir } }
      : {}),
    error: message,
  });
  const recordPath = await writeVercelDeployRecord(opts.recordsRoot, record);
  throw Object.assign(opts.error instanceof Error ? opts.error : new Error(message), {
    record,
    recordPath,
  });
}

export async function submitVercelDeploy(opts: {
  workspaceRoot: string;
  deployment: VercelDeployment;
  recordsRoot: string;
  artifactDir: string;
  operationKind?: VercelOperationKind;
  sourceRunId?: string;
  smokeConnectOverride?: VercelSmokeConnectOverride;
  apiClient?: VercelApiClient;
}): Promise<VercelDeployResult> {
  const runId = createVercelDeployRunId();
  const operationKind = opts.operationKind || "deploy";
  let artifact: AdmittedVercelPrebuiltArtifact | undefined;
  try {
    artifact = await admitVercelPrebuiltArtifact(opts.artifactDir);
    const secretRuntime = createVaultDeploymentSecretRuntime({
      admittedContext: {
        secretRequirements: opts.deployment.secretRequirements,
        targetEnvironment: {
          lockScope: opts.deployment.providerTarget.providerTargetIdentity,
        },
      },
      fallbackTargetScope: opts.deployment.providerTarget.providerTargetIdentity,
    });
    const publishSecrets = await secretRuntime.enterStep("publish");
    const published = await publishVercelPrebuilt({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      runId,
      deployment: opts.deployment,
      artifact,
      apiToken: publishSecrets.vercel_api_token || "",
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
      ...(opts.apiClient ? { apiClient: opts.apiClient } : {}),
    });
    const smokeMode = resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment });
    let smokeOutcome: VercelDeployRecord["smokeOutcome"] = "passed";
    if (smokeMode.mode === "omitted") {
      smokeOutcome = "omitted_by_exception";
    } else {
      await secretRuntime.enterStep("smoke");
      await smokeVercelConsole({
        deployment: opts.deployment,
        publicUrl: published.publicUrl,
        connectOverride: opts.smokeConnectOverride,
      });
    }
    const replaySnapshotPath =
      operationKind === "deploy"
        ? await writeVercelReplaySnapshot({
            recordsRoot: opts.recordsRoot,
            deployRunId: runId,
            deployment: opts.deployment,
            artifact: { identity: artifact.identity, outputDir: artifact.outputDir },
            providerReleaseId: published.providerReleaseId,
            publicUrl: published.publicUrl,
            aliasAssigned: published.aliasAssigned,
            providerConfigFingerprint: published.providerConfigFingerprint,
          })
        : undefined;
    const record = createVercelDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      finalOutcome: "succeeded",
      artifact: { identity: artifact.identity, outputDir: artifact.outputDir },
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId, parentRunId: opts.sourceRunId } : {}),
      ...(operationKind === "deploy"
        ? { releaseLineageId: runId, artifactLineageId: artifact.identity }
        : {}),
      ...(replaySnapshotPath ? { replaySnapshotPath } : {}),
      publicUrl: published.publicUrl,
      providerReleaseId: published.providerReleaseId,
      aliasAssigned: published.aliasAssigned,
      smokeOutcome,
      providerConfigFingerprint: published.providerConfigFingerprint,
    });
    return { record, recordPath: await writeVercelDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    return await writeFailure({
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      runId,
      operationKind,
      ...(artifact ? { artifact } : {}),
      error,
    });
  }
}

export function summarizeVercelResult(result: VercelDeployResult): DeploymentExecutionResult {
  return { record: result.record, recordPath: result.recordPath };
}

export async function submitVercelPreviewCleanup(opts: {
  deployment: VercelDeployment;
  recordsRoot: string;
  sourceRunId: string;
  apiClient?: VercelApiClient;
}): Promise<VercelDeployResult> {
  if (!opts.sourceRunId.trim()) throw new Error("vercel preview cleanup requires sourceRunId");
  const runId = createVercelDeployRunId("vercel-preview-cleanup");
  try {
    const secretRuntime = createVaultDeploymentSecretRuntime({
      admittedContext: {
        secretRequirements: opts.deployment.secretRequirements,
        targetEnvironment: {
          lockScope: opts.deployment.providerTarget.providerTargetIdentity,
        },
      },
      fallbackTargetScope: opts.deployment.providerTarget.providerTargetIdentity,
    });
    const cleanupSecrets = await secretRuntime.enterStep("preview_cleanup");
    const cleanup = await cleanupVercelPreview({
      deployment: opts.deployment,
      sourceRunId: opts.sourceRunId,
      apiToken: cleanupSecrets.vercel_api_token || "",
      ...(opts.apiClient ? { apiClient: opts.apiClient } : {}),
    });
    if (!cleanup.cleaned || !cleanup.deploymentId.trim()) {
      throw new Error("vercel preview cleanup rejected ambiguous cleanup outcome");
    }
    const record = createVercelDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind: "preview_cleanup",
      runClassification: "preview_cleanup",
      finalOutcome: "succeeded",
      sourceRunId: opts.sourceRunId,
      providerReleaseId: cleanup.deploymentId,
    });
    return { record, recordPath: await writeVercelDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    return await writeFailure({
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      runId,
      operationKind: "preview_cleanup",
      error,
    });
  }
}
