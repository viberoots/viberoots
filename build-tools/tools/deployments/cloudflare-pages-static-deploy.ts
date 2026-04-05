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
  type CloudflarePagesDeployRecord,
  writeCloudflarePagesDeployRecord,
} from "./cloudflare-pages-records.ts";
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
  authority?: CloudflarePagesControlPlaneWorkerAuthority;
  admittedContext: CloudflarePagesAdmittedContext;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ record: CloudflarePagesDeployRecord; recordPath: string }> {
  const authority = requireCloudflarePagesControlPlaneAuthority(opts.deployment, opts.authority);
  const runId = createCloudflarePagesDeployRunId();
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  let providerConfigFingerprint: string | undefined;
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
      finalOutcome: "succeeded",
      artifactIdentity: opts.artifact.identity,
      artifactStoredArtifactPath: opts.artifact.storedArtifactPath,
      artifactProvenancePath: opts.artifact.provenancePath,
      admittedContext: opts.admittedContext,
      authority,
      deploymentMetadataFingerprint,
      providerConfigFingerprint,
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
      finalOutcome: failedStep === "smoke" ? "smoke_failed_after_publish" : "publish_failed",
      artifactIdentity: opts.artifact.identity,
      artifactStoredArtifactPath: opts.artifact.storedArtifactPath,
      artifactProvenancePath: opts.artifact.provenancePath,
      admittedContext: opts.admittedContext,
      authority,
      failedStep,
      deploymentMetadataFingerprint,
      ...(providerConfigFingerprint ? { providerConfigFingerprint } : {}),
      error: message,
    });
    const recordPath = await writeCloudflarePagesDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
