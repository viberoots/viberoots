#!/usr/bin/env zx-wrapper
import {
  requireNixosSharedHostControlPlaneAuthority,
  type NixosSharedHostControlPlaneWorkerAuthority,
} from "./nixos-shared-host-control-plane-contract.ts";
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
import {
  materializeNixosSharedHostRuntime,
  nixosSharedHostContainerRoot,
} from "./nixos-shared-host-runtime.ts";
import { publishNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-publisher.ts";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke.ts";

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
  artifactDir: string;
  statePath: string;
  hostRoot: string;
  recordsRoot: string;
  hostConfigPath?: string;
  authority?: NixosSharedHostControlPlaneWorkerAuthority;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const authority = requireNixosSharedHostControlPlaneAuthority(opts.deployment, opts.authority);
  const runId = createNixosSharedHostDeployRunId();
  try {
    const current = await readNixosSharedHostPlatformStateOrEmpty(opts.statePath);
    const state = applyNixosSharedHostScopedDeployments(current, [opts.deployment]);
    await writeJsonDocument(opts.statePath, state);
    const rendered = renderNixosSharedHostConfig(state);
    if (opts.hostConfigPath) await writeJsonDocument(opts.hostConfigPath, rendered);
    await materializeNixosSharedHostRuntime(opts.hostRoot, rendered);
    const container = rendered.containers[opts.deployment.providerTarget.containerName];
    const published = await publishNixosSharedHostStaticWebapp({
      artifactDir: opts.artifactDir,
      containerRoot: nixosSharedHostContainerRoot(opts.hostRoot, container.containerName),
      layout: {
        releaseRoot: container.releaseRoot,
        publishRoot: container.publishRoot,
        activeReleaseLink: container.activeReleaseLink,
      },
    }).catch((error) => {
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
      runClassification: "deploy",
      finalOutcome: "succeeded",
      artifactIdentity: published.artifactIdentity,
      artifactLineageId: published.artifactIdentity,
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
      runClassification: "deploy",
      finalOutcome,
      failedStep,
      error: message,
      authority,
    });
    const recordPath = await writeNixosSharedHostDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
