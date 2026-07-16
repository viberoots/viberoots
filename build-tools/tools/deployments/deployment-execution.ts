#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  isAppStoreConnectDeployment,
  isGooglePlayDeployment,
  isKubernetesDeployment,
  isNixosSharedHostDeployment,
  isS3StaticDeployment,
  isVercelDeployment,
  type DeploymentTarget,
} from "./contract";
import { submitAppStoreConnectDeploy } from "./app-store-connect-deploy";
import { submitGooglePlayDeploy } from "./google-play-deploy";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import {
  artifactDirFromBuiltOutPath,
  buildArtifactDirsByComponentId,
  buildDeploymentSelectedOutPath,
} from "./deployment-component-artifact-dirs";
import { isMultiComponentNixosSharedHostDeployment } from "./nixos-shared-host-components";
import { submitCloudflarePagesControlPlaneDeploy } from "./cloudflare-pages-control-plane";
import { submitKubernetesDeploy } from "./kubernetes-deploy";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane";
import { submitS3StaticDeploy } from "./s3-static-deploy";
import { submitVercelDeploy, summarizeVercelResult } from "./vercel-deploy";

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
  recordPath?: string;
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

function defaultAppStoreConnectRecordsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".local", "deployments", "app-store-connect", "records");
}

function defaultGooglePlayRecordsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".local", "deployments", "google-play", "records");
}

function defaultKubernetesRecordsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".local", "deployments", "kubernetes", "records");
}

function defaultVercelRecordsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".local", "deployments", "vercel", "records");
}

async function resolveArtifactDir(
  workspaceRoot: string,
  deployment: Pick<DeploymentTarget, "component">,
): Promise<string> {
  const outPath = await buildDeploymentSelectedOutPath(workspaceRoot, deployment.component.target);
  return artifactDirFromBuiltOutPath(deployment.component.kind, outPath);
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
  if (isAppStoreConnectDeployment(opts.deployment)) {
    return await submitAppStoreConnectDeploy({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: path.resolve(
        opts.sharedRecordsRoot || defaultAppStoreConnectRecordsRoot(opts.workspaceRoot),
      ),
      artifactPath: await resolveArtifactDir(opts.workspaceRoot, opts.deployment),
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    });
  }
  if (isGooglePlayDeployment(opts.deployment)) {
    return await submitGooglePlayDeploy({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: path.resolve(
        opts.sharedRecordsRoot || defaultGooglePlayRecordsRoot(opts.workspaceRoot),
      ),
      artifactPath: await resolveArtifactDir(opts.workspaceRoot, opts.deployment),
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    });
  }
  if (isKubernetesDeployment(opts.deployment)) {
    const artifactDirsByComponentId =
      opts.deployment.components.length > 1
        ? await buildArtifactDirsByComponentId(opts.workspaceRoot, opts.deployment)
        : undefined;
    return await submitKubernetesDeploy({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: path.resolve(
        opts.sharedRecordsRoot || defaultKubernetesRecordsRoot(opts.workspaceRoot),
      ),
      ...(artifactDirsByComponentId
        ? { artifactDirsByComponentId }
        : { artifactDir: await resolveArtifactDir(opts.workspaceRoot, opts.deployment) }),
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    });
  }
  if (isVercelDeployment(opts.deployment)) {
    return summarizeVercelResult(
      await submitVercelDeploy({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        recordsRoot: path.resolve(
          opts.sharedRecordsRoot || defaultVercelRecordsRoot(opts.workspaceRoot),
        ),
        artifactDir: await resolveArtifactDir(opts.workspaceRoot, opts.deployment),
        ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      }),
    );
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
export async function runExplicitRemovalDeployment(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  sharedRecordsRoot?: string;
  hostRoot?: string;
  statePath?: string;
  hostConfigPath?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
}): Promise<DeploymentExecutionResult> {
  if (!isNixosSharedHostDeployment(opts.deployment)) {
    throw new Error(
      `from-changes removal is not supported for provider "${opts.deployment.provider}" on ${opts.deployment.label}`,
    );
  }
  const hostRoot = path.resolve(opts.hostRoot || defaultNixosHostRoot(opts.workspaceRoot));
  return await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: "explicit_removal",
    deployment: opts.deployment,
    paths: {
      statePath: path.resolve(opts.statePath || path.join(hostRoot, "platform-state.json")),
      hostRoot,
      recordsRoot: path.resolve(opts.sharedRecordsRoot || path.join(hostRoot, "records")),
      ...(opts.hostConfigPath ? { hostConfigPath: path.resolve(opts.hostConfigPath) } : {}),
    },
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
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
    ...("smokeOutcome" in result.record && (result.record as any).smokeOutcome
      ? { smokeOutcome: (result.record as any).smokeOutcome }
      : {}),
    ...("executionPolicy" in result.record && (result.record as any).executionPolicy
      ? { executionPolicy: (result.record as any).executionPolicy }
      : {}),
    publicUrl: result.record.publicUrl,
    ...(result.recordPath ? { recordPath: result.recordPath } : {}),
    ...(result.record.controlPlane ? { controlPlane: result.record.controlPlane } : {}),
  };
}
