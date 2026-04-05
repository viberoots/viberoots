#!/usr/bin/env zx-wrapper
import {
  requireNixosSharedHostControlPlaneAuthority,
  type NixosSharedHostControlPlaneWorkerAuthority,
} from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import {
  requireNixosSharedHostAdmittedArtifactPath,
  type NixosSharedHostAdmittedArtifact,
} from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  readNixosSharedHostPlatformStateOrEmpty,
  writeJsonDocument,
} from "./nixos-shared-host-io.ts";
import { applyNixosSharedHostScopedDeployments } from "./nixos-shared-host-platform.ts";
import { renderNixosSharedHostConfig } from "./nixos-shared-host.ts";
import {
  createNixosSharedHostDeployRecord,
  createNixosSharedHostDeployRunId,
  type NixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import { writeNixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay.ts";
import {
  materializeNixosSharedHostRuntime,
  nixosSharedHostContainerRoot,
} from "./nixos-shared-host-runtime.ts";
import { publishNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-publisher.ts";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke.ts";

type StaticOperationKind = "deploy" | "promotion" | "retry" | "rollback";
type StaticPublishBehavior = "deploy" | "publish-only";
type DeployFailureStep = "provision" | "publish" | "smoke";

function withFailedStep(
  step: DeployFailureStep,
  error: unknown,
): Error & { failedStep: DeployFailureStep } {
  const base = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { failedStep: step });
}

export async function runNixosSharedHostStaticDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  operationKind?: StaticOperationKind;
  publishBehavior?: StaticPublishBehavior;
  artifact: NixosSharedHostAdmittedArtifact;
  statePath: string;
  hostRoot: string;
  recordsRoot: string;
  deployBatchId?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  hostConfigPath?: string;
  authority?: NixosSharedHostControlPlaneWorkerAuthority;
  admittedContext?: NixosSharedHostAdmittedContext;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const authority = requireNixosSharedHostControlPlaneAuthority(opts.deployment, opts.authority);
  const runId = createNixosSharedHostDeployRunId();
  const operationKind = opts.operationKind || "deploy";
  const publishBehavior = opts.publishBehavior || "deploy";
  let deploymentMetadataFingerprint: string | undefined;
  let replaySnapshotPath: string | undefined;
  try {
    const current = await readNixosSharedHostPlatformStateOrEmpty(opts.statePath);
    const state =
      publishBehavior === "deploy"
        ? applyNixosSharedHostScopedDeployments(current, [opts.deployment])
        : current;
    if (publishBehavior === "deploy") await writeJsonDocument(opts.statePath, state);
    const rendered = renderNixosSharedHostConfig(state);
    if (opts.hostConfigPath) await writeJsonDocument(opts.hostConfigPath, rendered);
    const container = rendered.containers[opts.deployment.providerTarget.containerName];
    if (!container) {
      throw withFailedStep(
        publishBehavior === "deploy" ? "provision" : "publish",
        new Error(
          `publish-only requires an existing realized target: ${opts.deployment.providerTarget.sharedDevTargetIdentity}`,
        ),
      );
    }
    ({ deploymentMetadataFingerprint, replaySnapshotPath } =
      await writeNixosSharedHostReplaySnapshot({
        recordsRoot: opts.recordsRoot,
        deployRunId: runId,
        deployment: opts.deployment,
        artifact: opts.artifact,
        admittedContext: opts.admittedContext!,
        platformState: state,
        hostConfig: rendered,
        controlPlaneExecutionSnapshotPath: authority.executionSnapshotPath,
      }));
    if (publishBehavior === "deploy") {
      await materializeNixosSharedHostRuntime(opts.hostRoot, rendered).catch((error) => {
        throw withFailedStep("provision", error);
      });
    }
    const published = await (async () =>
      await publishNixosSharedHostStaticWebapp({
        artifactDir: await requireNixosSharedHostAdmittedArtifactPath(opts.artifact),
        artifactIdentity: opts.artifact.identity,
        containerRoot: nixosSharedHostContainerRoot(opts.hostRoot, container.containerName),
        layout: {
          releaseRoot: container.releaseRoot,
          publishRoot: container.publishRoot,
          activeReleaseLink: container.activeReleaseLink,
        },
      }))().catch((error) => {
      throw withFailedStep("publish", error);
    });
    const smoke = await smokeNixosSharedHostStaticWebapp({
      hostname: opts.deployment.providerTarget.hostname,
      indexPath: published.indexPath,
      healthPath: opts.deployment.runtime.healthPath,
      connectOverride: opts.smokeConnectOverride,
    }).catch((error) => {
      throw withFailedStep("smoke", error);
    });
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      finalOutcome: "succeeded",
      ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      artifactIdentity: opts.artifact.identity,
      artifactStoredArtifactPath: opts.artifact.storedArtifactPath,
      artifactProvenancePath: opts.artifact.provenancePath,
      artifactLineageId: opts.artifactLineageId || opts.artifact.identity,
      ...(opts.admittedContext ? { admittedContext: opts.admittedContext } : {}),
      ...(deploymentMetadataFingerprint ? { deploymentMetadataFingerprint } : {}),
      ...(replaySnapshotPath ? { replaySnapshotPath } : {}),
      publicUrl: smoke.publicUrl,
      healthUrl: smoke.healthUrl,
      authority,
    });
    return { record, recordPath: await writeNixosSharedHostDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedStep =
      error &&
      typeof error === "object" &&
      "failedStep" in error &&
      (error.failedStep === "provision" ||
        error.failedStep === "publish" ||
        error.failedStep === "smoke")
        ? error.failedStep
        : "provision";
    const finalOutcome =
      failedStep === "smoke"
        ? "smoke_failed_after_publish"
        : failedStep === "publish"
          ? "publish_failed"
          : "provision_failed";
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      finalOutcome,
      ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      artifactIdentity: opts.artifact.identity,
      artifactStoredArtifactPath: opts.artifact.storedArtifactPath,
      artifactProvenancePath: opts.artifact.provenancePath,
      artifactLineageId: opts.artifactLineageId || opts.artifact.identity,
      ...(opts.admittedContext ? { admittedContext: opts.admittedContext } : {}),
      failedStep,
      error: message,
      ...(deploymentMetadataFingerprint ? { deploymentMetadataFingerprint } : {}),
      ...(replaySnapshotPath ? { replaySnapshotPath } : {}),
      authority,
    });
    const recordPath = await writeNixosSharedHostDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
