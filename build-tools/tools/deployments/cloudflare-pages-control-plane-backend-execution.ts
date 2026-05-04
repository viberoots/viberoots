#!/usr/bin/env zx-wrapper
import {
  resolveCloudflarePagesAdmittedSecretReferences,
  type CloudflarePagesAdmittedContext,
} from "./cloudflare-pages-admission";
import type { CloudflarePagesControlPlaneSnapshot } from "./cloudflare-pages-control-plane-contract";
import {
  createCloudflarePagesDeployRecord,
  createCloudflarePagesDeployRunId,
  writeCloudflarePagesDeployRecord,
  type CloudflarePagesDeployRecord,
} from "./cloudflare-pages-records";
import type { CloudflarePagesStaticDeployStep } from "./cloudflare-pages-static-deploy-options";
import {
  persistCloudflareBackendStatus,
  type CloudflareBackendSubmissionLike,
} from "./cloudflare-pages-control-plane-backend-status";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import { revalidateControlPlaneAdmission } from "./deployment-control-plane-revalidation";
import {
  writeBackendSnapshotDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";

export type CloudflareBackendExecutionStep =
  | "vault"
  | "admission_revalidation"
  | "target_transition"
  | "preview_cleanup"
  | CloudflarePagesStaticDeployStep;

type CloudflareBackendFailedStep = NonNullable<CloudflarePagesDeployRecord["failedStep"]>;

export const DEFAULT_VAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_PUBLISH_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_PREVIEW_CLEANUP_TIMEOUT_MS = 5 * 60_000;

function positiveEnvInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

export function cloudflareBackendTimeouts(): {
  vaultMs: number;
  publishMs: number;
  smokeMs?: number;
  previewCleanupMs: number;
} {
  const smokeMs = positiveEnvInt("BNX_DEPLOY_CLOUDFLARE_SMOKE_TIMEOUT_MS");
  return {
    vaultMs: positiveEnvInt("BNX_DEPLOY_CLOUDFLARE_VAULT_TIMEOUT_MS") || DEFAULT_VAULT_TIMEOUT_MS,
    publishMs:
      positiveEnvInt("BNX_DEPLOY_CLOUDFLARE_PUBLISH_TIMEOUT_MS") || DEFAULT_PUBLISH_TIMEOUT_MS,
    ...(smokeMs ? { smokeMs } : {}),
    previewCleanupMs:
      positiveEnvInt("BNX_DEPLOY_CLOUDFLARE_PREVIEW_CLEANUP_TIMEOUT_MS") ||
      DEFAULT_PREVIEW_CLEANUP_TIMEOUT_MS,
  };
}

function failedStepForExecutionStep(
  step: CloudflareBackendExecutionStep,
): CloudflareBackendFailedStep {
  if (step === "vault") return "vault";
  if (step === "smoke") return "smoke";
  if (step === "preview_cleanup") return "preview_cleanup";
  return "publish";
}

function timeoutError(step: CloudflareBackendExecutionStep, timeoutMs: number): Error {
  return Object.assign(new Error(`cloudflare-pages ${step} timed out after ${timeoutMs}ms`), {
    code: "cloudflare_worker_step_timeout",
    failedStep: failedStepForExecutionStep(step),
  });
}

export async function withStepTimeout<T>(
  step: CloudflareBackendExecutionStep,
  timeoutMs: number | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!timeoutMs) return await run();
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(timeoutError(step, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function failedStepFromError(error: unknown): CloudflareBackendFailedStep {
  const failedStep = (error as { failedStep?: unknown } | undefined)?.failedStep;
  return failedStep === "vault" ||
    failedStep === "smoke" ||
    failedStep === "preview_cleanup" ||
    failedStep === "publish"
    ? failedStep
    : "publish";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function updateCloudflareBackendStep(
  running: CloudflareBackendSubmissionLike,
  step: CloudflareBackendExecutionStep,
  metadata: { mutationStep?: boolean; timeoutMs?: number } = {},
): CloudflareBackendSubmissionLike {
  const now = new Date().toISOString();
  return {
    ...running,
    execution: {
      ...(running.execution || {}),
      currentStep: step,
      stepStartedAt: now,
      ...(metadata.mutationStep
        ? { mutationStartedAt: running.execution?.mutationStartedAt || now }
        : {}),
      ...(metadata.timeoutMs ? { timeoutMs: metadata.timeoutMs } : {}),
    },
  };
}

export async function persistCloudflareBackendStep(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotRef: string;
  running: CloudflareBackendSubmissionLike;
}): Promise<void> {
  await persistCloudflareBackendStatus({
    backend: opts.backend,
    submissionPath: opts.submissionPath,
    submissionRef: opts.submissionRef,
    executionSnapshotRef: opts.executionSnapshotRef,
    submission: opts.running,
  });
}

export async function prepareWorkerAdmittedSnapshot(opts: {
  workspaceRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  snapshot: CloudflarePagesControlPlaneSnapshot;
  secretContext?: DeploymentSecretContext;
}) {
  if (!opts.snapshot.admittedContext) return;
  await revalidateControlPlaneAdmission({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.snapshot.deployment,
    admittedContext: opts.snapshot.admittedContext,
  });
  opts.snapshot.admittedContext = {
    ...opts.snapshot.admittedContext,
    admittedSecretReferences: await resolveCloudflarePagesAdmittedSecretReferences({
      deployment: opts.snapshot.deployment,
      admittedContext: opts.snapshot.admittedContext as CloudflarePagesAdmittedContext,
      ...(opts.secretContext ? { secretContext: opts.secretContext } : {}),
    }),
  };
  await writeControlPlaneJson(opts.executionSnapshotPath, opts.snapshot);
  await writeBackendSnapshotDoc(opts.backend, opts.snapshot, opts.executionSnapshotRef);
}

export async function writeCloudflareBackendFailureRecord(opts: {
  recordsRoot: string;
  workerId: string;
  submissionRef: string;
  executionSnapshotPath: string;
  running: CloudflareBackendSubmissionLike;
  snapshot: CloudflarePagesControlPlaneSnapshot;
  error: unknown;
}): Promise<{ record: CloudflarePagesDeployRecord; recordPath: string }> {
  const failedStep = failedStepFromError(opts.error);
  const artifact =
    opts.snapshot.action?.kind === "deploy"
      ? opts.snapshot.action.publishInput.artifact
      : undefined;
  const record = createCloudflarePagesDeployRecord(opts.snapshot.deployment, {
    deployRunId: opts.running.deployRunId || createCloudflarePagesDeployRunId(),
    operationKind: opts.snapshot.operationKind,
    runClassification: opts.snapshot.operationKind,
    publishMode: opts.snapshot.action?.publishMode || "normal",
    finalOutcome: failedStep === "smoke" ? "smoke_failed_after_publish" : "publish_failed",
    ...(opts.snapshot.deployBatchId ? { deployBatchId: opts.snapshot.deployBatchId } : {}),
    ...(opts.snapshot.action?.parentRunId ? { parentRunId: opts.snapshot.action.parentRunId } : {}),
    ...(opts.snapshot.action?.releaseLineageId
      ? { releaseLineageId: opts.snapshot.action.releaseLineageId }
      : {}),
    ...(artifact?.identity ? { artifactIdentity: artifact.identity } : {}),
    ...(artifact?.storedArtifactPath
      ? { artifactStoredArtifactPath: artifact.storedArtifactPath }
      : {}),
    ...(artifact?.provenancePath ? { artifactProvenancePath: artifact.provenancePath } : {}),
    admittedContext: opts.snapshot.admittedContext,
    failedStep,
    authority: {
      kind: "control-plane-worker",
      submissionId: opts.snapshot.submissionId,
      submissionPath: opts.submissionRef,
      workerId: opts.workerId,
      lockScope: opts.snapshot.lockScope,
      executionSnapshotPath: opts.executionSnapshotPath,
    },
    error: errorMessage(opts.error),
  });
  return {
    record,
    recordPath: await writeCloudflarePagesDeployRecord(opts.recordsRoot, record),
  };
}
