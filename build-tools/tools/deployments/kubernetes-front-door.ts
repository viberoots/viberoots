#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import type { KubernetesDeployment } from "./contract.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import {
  resolveArtifactDirForCli,
  resolveComponentArtifactDirsForCli,
} from "./deployment-cli-resolve.ts";
import { printDeployJson } from "./deploy-front-door.ts";
import { submitKubernetesDeploy } from "./kubernetes-deploy.ts";

export async function runKubernetesDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
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
    throw new Error("kubernetes deploys do not support --preview or --preview-cleanup");
  }
  if (getFlagBool("remove")) throw new Error("kubernetes deploys do not support --remove yet");
  if (opts.publishOnly || opts.rollback || opts.sourceRunId) {
    throw new Error("kubernetes initial slice supports only normal deploy runs");
  }
  if (opts.provisionOnly) {
    throw new Error(
      "kubernetes initial slice provisions as part of deploy; --provision-only is not supported",
    );
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "kubernetes", "records"),
    ),
  );
  const result = await submitKubernetesDeploy({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot,
    ...(opts.deployment.components.length > 1
      ? {
          artifactDirsByComponentId: await resolveComponentArtifactDirsForCli(
            opts.workspaceRoot,
            opts.deployment,
          ),
        }
      : {
          artifactDir:
            opts.artifactDirFlag ||
            (await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment)),
        }),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
  printDeployJson(summarizeDeploymentResult(result));
}
