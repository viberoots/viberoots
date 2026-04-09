#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import type { S3StaticDeployment } from "./contract.ts";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import { printDeployJson } from "./deploy-front-door.ts";
import { submitS3StaticDeploy } from "./s3-static-deploy.ts";

export async function runS3StaticDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  publishOnly: boolean;
  provisionOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
}) {
  if (getFlagBool("bootstrap") || getFlagStr("bootstrap-reconcile-run-id", "").trim()) {
    throw new Error("bootstrap is currently supported only for nixos-shared-host deployments");
  }
  if (getFlagBool("preview") || getFlagBool("preview-cleanup")) {
    throw new Error("s3-static deploys do not support --preview or --preview-cleanup");
  }
  if (getFlagBool("remove")) throw new Error("s3-static deploys do not support --remove yet");
  if (opts.publishOnly || opts.rollback || opts.sourceRunId) {
    throw new Error("s3-static initial slice supports only normal deploy runs");
  }
  if (opts.provisionOnly) {
    throw new Error(
      "s3-static initial slice provisions as part of deploy; --provision-only is not supported",
    );
  }
  const result = await submitS3StaticDeploy({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactDir:
      opts.artifactDirFlag || (await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment)),
    recordsRoot: path.resolve(
      getFlagStr(
        "records-root",
        path.join(opts.workspaceRoot, ".local", "deployments", "s3-static", "records"),
      ),
    ),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
  printDeployJson(summarizeDeploymentResult(result));
}
