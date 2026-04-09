#!/usr/bin/env zx-wrapper
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import {
  isNixosSharedHostDeployment,
  isS3StaticDeployment,
  type DeploymentTarget,
} from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { buildArtifactDirsByComponentId } from "./deployment-component-artifact-dirs.ts";
import { isMultiComponentNixosSharedHostDeployment } from "./nixos-shared-host-components.ts";
import { submitCloudflarePagesControlPlaneDeploy } from "./cloudflare-pages-control-plane.ts";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane.ts";
import { submitS3StaticDeploy } from "./s3-static-deploy.ts";

export type DeploymentSmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  rejectUnauthorized?: boolean;
};

export type DeploymentExecutionResult = {
  record: {
    deployRunId: string;
    operationKind: string;
    runClassification: string;
    finalOutcome: string;
    artifact?: { identity: string };
    componentResults?: Array<{
      componentId: string;
      providerTargetIdentity: string;
      finalOutcome: string;
    }>;
    parentRunId?: string;
    publicUrl?: string;
    controlPlane?: unknown;
    deployBatchId?: string;
  };
  recordPath: string;
};

function defaultNixosHostRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host");
}

function defaultCloudflareRecordsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".local", "deployments", "cloudflare-pages", "records");
}

function defaultS3StaticRecordsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".local", "deployments", "s3-static", "records");
}

async function resolveArtifactDir(
  workspaceRoot: string,
  deployment: Pick<DeploymentTarget, "component">,
): Promise<string> {
  const outPath = await buildSelectedOutPath(workspaceRoot, deployment.component.target);
  return path.join(outPath, "dist");
}

export async function runNormalDeployment(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  sharedRecordsRoot?: string;
  hostRoot?: string;
  statePath?: string;
  hostConfigPath?: string;
  smokeConnectOverride?: DeploymentSmokeConnectOverride;
  deployBatchId?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}): Promise<DeploymentExecutionResult> {
  if (isS3StaticDeployment(opts.deployment)) {
    return await submitS3StaticDeploy({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: path.resolve(
        opts.sharedRecordsRoot || defaultS3StaticRecordsRoot(opts.workspaceRoot),
      ),
      artifactDir: await resolveArtifactDir(opts.workspaceRoot, opts.deployment),
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    });
  }
  if (!isNixosSharedHostDeployment(opts.deployment)) {
    return await submitCloudflarePagesControlPlaneDeploy({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: path.resolve(
        opts.sharedRecordsRoot || defaultCloudflareRecordsRoot(opts.workspaceRoot),
      ),
      artifactDir: await resolveArtifactDir(opts.workspaceRoot, opts.deployment),
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
    });
  }
  const hostRoot = path.resolve(opts.hostRoot || defaultNixosHostRoot(opts.workspaceRoot));
  const artifactDirsByComponentId = isMultiComponentNixosSharedHostDeployment(opts.deployment)
    ? await buildArtifactDirsByComponentId(opts.workspaceRoot, opts.deployment)
    : undefined;
  return await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: "deploy",
    deployment: opts.deployment,
    ...(artifactDirsByComponentId
      ? { artifactDirsByComponentId }
      : { artifactDir: await resolveArtifactDir(opts.workspaceRoot, opts.deployment) }),
    paths: {
      statePath: path.resolve(opts.statePath || path.join(hostRoot, "platform-state.json")),
      hostRoot,
      recordsRoot: path.resolve(opts.sharedRecordsRoot || path.join(hostRoot, "records")),
      ...(opts.hostConfigPath ? { hostConfigPath: path.resolve(opts.hostConfigPath) } : {}),
    },
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
  });
}

export function summarizeDeploymentResult(result: DeploymentExecutionResult) {
  return {
    runId: result.record.deployRunId,
    deployRunId: result.record.deployRunId,
    operationKind: result.record.operationKind,
    runClassification: result.record.runClassification,
    finalOutcome: result.record.finalOutcome,
    artifactIdentity: result.record.artifact?.identity,
    ...(result.record.parentRunId ? { parentRunId: result.record.parentRunId } : {}),
    ...(result.record.deployBatchId ? { deployBatchId: result.record.deployBatchId } : {}),
    ...(result.record.componentResults ? { componentResults: result.record.componentResults } : {}),
    publicUrl: result.record.publicUrl,
    recordPath: result.recordPath,
    ...(result.record.controlPlane ? { controlPlane: result.record.controlPlane } : {}),
  };
}
