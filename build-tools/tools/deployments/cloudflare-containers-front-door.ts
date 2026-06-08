#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import type { CloudflareContainersDeployment } from "./contract";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import { summarizeDeploymentResult } from "./deployment-execution";
import { printDeployJson } from "./deploy-front-door";
import { submitCloudflareContainersDeploy } from "./cloudflare-containers-deploy";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
  shouldUseProtectedSharedServiceRoute,
} from "./deployment-service-client-selection";
import {
  finalizeProtectedFrontDoorSubmission,
  rejectServiceOnlyLocalFlags,
} from "./deployment-provider-protected-front-door";
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot";
import { CLOUDFLARE_CONTAINERS_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./cloudflare-containers-control-plane";

export async function runCloudflareContainersDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: CloudflareContainersDeployment;
  requireServiceForProtectedShared: boolean;
  artifactDirFlag: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  remote?: string;
  allowControlPlaneOverride: boolean;
  hasFlag?: (flag: string) => boolean;
}) {
  if (getFlagBool("preview") || getFlagBool("preview-cleanup")) {
    throw new Error("cloudflare-containers deploys do not support preview yet");
  }
  if (getFlagBool("publish-only") || getFlagBool("rollback") || getFlagBool("provision-only")) {
    throw new Error("cloudflare-containers supports only local fake normal deploys in this PR");
  }
  if (
    shouldUseProtectedSharedServiceRoute({
      deployment: opts.deployment,
      requireServiceForProtectedShared: opts.requireServiceForProtectedShared,
      controlPlaneUrl: opts.controlPlaneUrl,
      remote: opts.remote,
    })
  ) {
    rejectServiceOnlyLocalFlags(opts.hasFlag || (() => false), "cloudflare-containers");
    const serviceClient = await resolveProtectedSharedServiceClient({
      deployment: opts.deployment,
      controlPlaneUrl: opts.controlPlaneUrl,
      controlPlaneToken: opts.controlPlaneToken,
      remote: opts.remote,
      allowControlPlaneOverride: opts.allowControlPlaneOverride,
      workspaceRoot: opts.workspaceRoot,
      context: `cloudflare-containers ${opts.deployment.protectionClass} mutation`,
    });
    const artifactDir =
      opts.artifactDirFlag || (await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment));
    printDeployJson(
      await finalizeProtectedFrontDoorSubmission({
        controlPlaneUrl: serviceClient.controlPlaneUrl,
        controlPlaneToken: serviceClient.controlPlaneToken,
        request: {
          schemaVersion: CLOUDFLARE_CONTAINERS_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
          submissionId: createNixosSharedHostSubmissionId(),
          submittedAt: new Date().toISOString(),
          deployment: opts.deployment,
          operationKind: "deploy",
          artifactDir,
          controlPlaneSelection: serviceClientSelectionEvidence(serviceClient),
        },
      }),
    );
    return;
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "cloudflare-containers", "records"),
    ),
  );
  const artifactDir =
    opts.artifactDirFlag || (await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment));
  const result = await submitCloudflareContainersDeploy({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot,
    artifactDir,
  });
  printDeployJson(summarizeDeploymentResult(result));
}
