#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import {
  requireCloudflarePagesControlPlaneAuthority,
  type CloudflarePagesControlPlaneWorkerAuthority,
} from "./cloudflare-pages-control-plane-contract.ts";
import { prepareCloudflarePagesWranglerConfig } from "./cloudflare-pages-config.ts";
import { publishCloudflarePagesStaticWebapp } from "./cloudflare-pages-publisher.ts";
import {
  createCloudflarePagesDeployRecord,
  createCloudflarePagesDeployRunId,
  type CloudflarePagesOperationKind,
  type CloudflarePagesDeployRecord,
  writeCloudflarePagesDeployRecord,
} from "./cloudflare-pages-records.ts";
import { writeCloudflarePagesReplaySnapshot } from "./cloudflare-pages-replay.ts";
import { smokeCloudflarePagesStaticWebapp } from "./cloudflare-pages-static-smoke.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import {
  requireAdmittedStaticWebappArtifactPath,
  type AdmittedStaticWebappArtifact,
} from "./static-webapp-artifacts.ts";

type DeployFailureStep = "publish" | "smoke";

function withFailedStep(
  step: DeployFailureStep,
  error: unknown,
): Error & { failedStep: DeployFailureStep } {
  const base = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { failedStep: step });
}

export async function runCloudflarePagesStaticDeploy(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifact: AdmittedStaticWebappArtifact;
  recordsRoot: string;
  operationKind?: CloudflarePagesOperationKind;
  authority?: CloudflarePagesControlPlaneWorkerAuthority;
  admittedContext: CloudflarePagesAdmittedContext;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ record: CloudflarePagesDeployRecord; recordPath: string }> {
  const authority = requireCloudflarePagesControlPlaneAuthority(opts.deployment, opts.authority);
  const runId = createCloudflarePagesDeployRunId();
  const operationKind = opts.operationKind || "deploy";
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  let providerConfigFingerprint: string | undefined;
  let replaySnapshotPath: string | undefined;
  try {
    const artifactDir = await requireAdmittedStaticWebappArtifactPath(opts.artifact);
    const preparedConfig = await prepareCloudflarePagesWranglerConfig({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      outputPath: path.join(opts.recordsRoot, "provider-config", `${runId}.wrangler.json`),
    }).catch((error) => {
      throw withFailedStep("publish", error);
    });
    providerConfigFingerprint = preparedConfig.fingerprint;
    ({ replaySnapshotPath } = await writeCloudflarePagesReplaySnapshot({
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      deployment: opts.deployment,
      artifact: opts.artifact,
      admittedContext: opts.admittedContext,
      providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
      controlPlaneExecutionSnapshotPath: authority.executionSnapshotPath,
    }));
    const published = await publishCloudflarePagesStaticWebapp({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactDir,
      renderedConfigPath: preparedConfig.renderedConfigPath,
    }).catch((error) => {
      throw withFailedStep("publish", error);
    });
    const smoke = await smokeCloudflarePagesStaticWebapp({
      deployment: opts.deployment,
      indexPath: path.join(artifactDir, "index.html"),
      connectOverride: opts.smokeConnectOverride,
    }).catch((error) => {
      throw withFailedStep("smoke", error);
    });
    const record = createCloudflarePagesDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      finalOutcome: "succeeded",
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      artifactIdentity: opts.artifact.identity,
      artifactStoredArtifactPath: opts.artifact.storedArtifactPath,
      artifactProvenancePath: opts.artifact.provenancePath,
      artifactLineageId: opts.artifactLineageId || opts.artifact.identity,
      admittedContext: opts.admittedContext,
      authority,
      deploymentMetadataFingerprint,
      providerConfigFingerprint,
      ...(replaySnapshotPath ? { replaySnapshotPath } : {}),
      publicUrl: smoke.publicUrl,
      ...(published.providerReleaseId ? { providerReleaseId: published.providerReleaseId } : {}),
    });
    return {
      record,
      recordPath: await writeCloudflarePagesDeployRecord(opts.recordsRoot, record),
    };
  } catch (error) {
    const failedStep =
      error && typeof error === "object" && "failedStep" in error && error.failedStep === "smoke"
        ? "smoke"
        : "publish";
    const message = error instanceof Error ? error.message : String(error);
    const record = createCloudflarePagesDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      finalOutcome: failedStep === "smoke" ? "smoke_failed_after_publish" : "publish_failed",
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      artifactIdentity: opts.artifact.identity,
      artifactStoredArtifactPath: opts.artifact.storedArtifactPath,
      artifactProvenancePath: opts.artifact.provenancePath,
      artifactLineageId: opts.artifactLineageId || opts.artifact.identity,
      admittedContext: opts.admittedContext,
      authority,
      failedStep,
      deploymentMetadataFingerprint,
      ...(providerConfigFingerprint ? { providerConfigFingerprint } : {}),
      ...(replaySnapshotPath ? { replaySnapshotPath } : {}),
      error: message,
    });
    const recordPath = await writeCloudflarePagesDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
