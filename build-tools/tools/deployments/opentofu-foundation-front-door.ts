#!/usr/bin/env zx-wrapper
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph";
import { getFlagStr } from "../lib/cli";
import type { OpenTofuDeployment } from "./contract";
import { printDeployJson } from "./deploy-front-door";
import { summarizeDeploymentResult } from "./deployment-execution";
import { submitOpenTofuFoundationProvisionOnly } from "./opentofu-foundation-provision-only";

async function resolveMigrationBundlePath(opts: {
  workspaceRoot: string;
  deployment: OpenTofuDeployment;
  artifactDirFlag: string;
}): Promise<string> {
  if (opts.artifactDirFlag) return path.resolve(opts.artifactDirFlag);
  return await buildSelectedOutPath(
    opts.workspaceRoot,
    opts.deployment.migrationBundleRef || opts.deployment.component.target,
  );
}

export async function runOpenTofuFoundationFrontDoor(opts: {
  workspaceRoot: string;
  deployment: OpenTofuDeployment;
  provisionOnly: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  admissionEvidence?: unknown;
}) {
  if (!opts.provisionOnly) {
    throw new Error("opentofu deployments are provision-only; pass --provision-only");
  }
  if (opts.sourceRunId) {
    throw new Error("opentofu provision-only replay is not supported yet");
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "opentofu", "records"),
    ),
  );
  const result = await submitOpenTofuFoundationProvisionOnly({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot,
    migrationBundleArtifactPath: await resolveMigrationBundlePath(opts),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
  });
  printDeployJson(summarizeDeploymentResult(result));
}
