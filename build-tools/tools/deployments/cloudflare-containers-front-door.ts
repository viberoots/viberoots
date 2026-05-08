#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import type { CloudflareContainersDeployment } from "./contract";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import { summarizeDeploymentResult } from "./deployment-execution";
import { printDeployJson } from "./deploy-front-door";
import { submitCloudflareContainersDeploy } from "./cloudflare-containers-deploy";

export async function runCloudflareContainersDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: CloudflareContainersDeployment;
  requireServiceForProtectedShared: boolean;
  artifactDirFlag: string;
}) {
  if (getFlagBool("preview") || getFlagBool("preview-cleanup")) {
    throw new Error("cloudflare-containers deploys do not support preview yet");
  }
  if (getFlagBool("publish-only") || getFlagBool("rollback") || getFlagBool("provision-only")) {
    throw new Error("cloudflare-containers supports only local fake normal deploys in this PR");
  }
  if (
    opts.deployment.protectionClass !== "local_only" &&
    (opts.requireServiceForProtectedShared || getFlagStr("control-plane-url", "").trim())
  ) {
    throw new Error(
      "protected/shared cloudflare-containers live mutation is not reviewed; use local_only fixtures",
    );
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
