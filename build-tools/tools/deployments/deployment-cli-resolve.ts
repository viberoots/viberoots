#!/usr/bin/env zx-wrapper
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { resolveSelectedTargetLabel } from "../dev/target-label-resolver.ts";
import { getFlagStr } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
import { resolveDeploymentFromTarget } from "./deployment-query.ts";
import {
  artifactDirFromBuiltOutPath,
  buildArtifactDirsByComponentId,
  parseComponentArtifactDirs,
} from "./deployment-component-artifact-dirs.ts";

export async function resolveDeploymentForCli(
  workspaceRoot: string,
  requireFlag: (name: string) => string,
  opts: {
    deploymentJsonErrorMessage?: string;
  } = {},
): Promise<DeploymentTarget> {
  if (getFlagStr("deployment-json", "").trim()) {
    throw new Error(
      opts.deploymentJsonErrorMessage ||
        "--deployment-json is not supported; use --deployment <label>",
    );
  }
  const deploymentTarget = await resolveSelectedTargetLabel(
    workspaceRoot,
    requireFlag("deployment"),
    { baseDir: process.cwd() },
  );
  return await resolveDeploymentFromTarget(workspaceRoot, deploymentTarget);
}

export async function resolveArtifactDirForCli(
  workspaceRoot: string,
  deployment: Pick<DeploymentTarget, "component">,
): Promise<string> {
  const artifactDir = getFlagStr("artifact-dir", "").trim();
  if (artifactDir) return path.resolve(artifactDir);
  const outPath = await buildSelectedOutPath(workspaceRoot, deployment.component.target);
  return artifactDirFromBuiltOutPath(deployment.component.kind, outPath);
}

export async function resolveComponentArtifactDirsForCli(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<Record<string, string>> {
  const flagValue = getFlagStr("component-artifacts", "").trim();
  return flagValue
    ? parseComponentArtifactDirs(flagValue)
    : await buildArtifactDirsByComponentId(workspaceRoot, deployment);
}
