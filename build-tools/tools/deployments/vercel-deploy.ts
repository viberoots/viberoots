#!/usr/bin/env zx-wrapper
import { createDeploymentSecretRuntimeForAdmittedContext } from "./deployment-secret-runtime-helpers";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy";
import type { DeploymentExecutionResult } from "./deployment-execution";
import type { VercelDeployment } from "./contract";
import {
  admitVercelPrebuiltArtifact,
  type AdmittedVercelPrebuiltArtifact,
} from "./vercel-artifacts";
import type { VercelAdmittedContext } from "./vercel-admission";
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
import { vercelFailureErrorFields } from "./vercel-record-diagnostics";
import { writeVercelReplaySnapshot } from "./vercel-replay";

type VercelDeployResult = { record: VercelDeployRecord; recordPath: string };

function failureOutcome(error: unknown): VercelDeployRecord["finalOutcome"] {
  const message = error instanceof Error ? error.message : String(error);
  const outcome = (error as any)?.outcome;
  if (outcome === "pending") return "pending";
  if (outcome === "ambiguous") return "ambiguous";
  return /smoke/.test(message) ? "smoke_failed_after_publish" : "publish_failed";
}

async function writeFailure(opts: {
  recordsRoot: string;
  deployment: VercelDeployment;
  runId: string;
  operationKind: VercelOperationKind;
  artifact?: AdmittedVercelPrebuiltArtifact;
  sourceRunId?: string;
  error: unknown;
  secrets?: readonly string[];
}): Promise<never> {
  const message = opts.error instanceof Error ? opts.error.message : String(opts.error);
  const record = createVercelDeployRecord(opts.deployment, {
    deployRunId: opts.runId,
    operationKind: opts.operationKind,
    runClassification: opts.operationKind,
    finalOutcome: failureOutcome(opts.error),
    ...(opts.artifact ? { artifact: { ...opts.artifact } } : {}),
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId, parentRunId: opts.sourceRunId } : {}),
    ...((opts.error as any)?.providerReleaseId
      ? { providerReleaseId: String((opts.error as any).providerReleaseId) }
      : {}),
    ...((opts.error as any)?.publicUrl ? { publicUrl: String((opts.error as any).publicUrl) } : {}),
    ...vercelFailureErrorFields(opts.error, { secrets: opts.secrets || [] }),
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
  artifact?: AdmittedVercelPrebuiltArtifact;
  admittedContext?: VercelAdmittedContext;
  operationKind?: VercelOperationKind;
  sourceRunId?: string;
  smokeConnectOverride?: VercelSmokeConnectOverride;
  apiClient?: VercelApiClient;
}): Promise<VercelDeployResult> {
  const runId = createVercelDeployRunId();
  const operationKind = opts.operationKind || "deploy";
  let artifact: AdmittedVercelPrebuiltArtifact | undefined;
  let secrets: string[] = [];
  try {
    artifact = opts.artifact || (await admitVercelPrebuiltArtifact(opts.artifactDir));
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
    secrets = [String(publishSecrets.vercel_api_token || "")];
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
      operationKind === "deploy" && opts.admittedContext
        ? await writeVercelReplaySnapshot({
            recordsRoot: opts.recordsRoot,
            deployRunId: runId,
            deployment: opts.deployment,
            artifact: { ...artifact },
            providerReleaseId: published.providerReleaseId,
            publicUrl: published.publicUrl,
            aliasAssigned: published.aliasAssigned,
            providerConfigFingerprint: published.providerConfigFingerprint,
            admittedContext: opts.admittedContext as any,
          })
        : undefined;
    const record = createVercelDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      finalOutcome: "succeeded",
      artifact: { ...artifact },
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
      ...(opts.admittedContext ? { admittedContext: opts.admittedContext as any } : {}),
    });
    return { record, recordPath: await writeVercelDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    return await writeFailure({
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      runId,
      operationKind,
      ...(artifact ? { artifact } : {}),
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
      error,
      secrets,
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
  providerDeploymentId?: string;
  apiClient?: VercelApiClient;
  admittedContext?: VercelAdmittedContext;
}): Promise<VercelDeployResult> {
  if (!opts.sourceRunId.trim()) throw new Error("vercel preview cleanup requires sourceRunId");
  const runId = createVercelDeployRunId("vercel-preview-cleanup");
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
    const cleanupSecrets = await secretRuntime.enterStep("preview_cleanup");
    secrets = [String(cleanupSecrets.vercel_api_token || "")];
    const cleanup = await cleanupVercelPreview({
      deployment: opts.deployment,
      sourceRunId: opts.sourceRunId,
      apiToken: cleanupSecrets.vercel_api_token || "",
      ...(opts.providerDeploymentId ? { providerDeploymentId: opts.providerDeploymentId } : {}),
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
      ...(opts.admittedContext ? { admittedContext: opts.admittedContext as any } : {}),
    });
    return { record, recordPath: await writeVercelDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    return await writeFailure({
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      runId,
      operationKind: "preview_cleanup",
      sourceRunId: opts.sourceRunId,
      error,
      secrets,
    });
  }
}
