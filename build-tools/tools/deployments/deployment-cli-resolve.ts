#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { resolveSelectedTargetLabel } from "../dev/target-label-resolver.ts";
import { getFlagStr } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
import { resolveDeploymentFromTarget } from "./deployment-query.ts";
import {
  buildArtifactDirsByComponentId,
  parseComponentArtifactDirs,
} from "./deployment-component-artifact-dirs.ts";
import { DEPLOYMENT_EXTRACTED_METADATA_SCHEMA } from "./deployment-control-plane-contract.ts";

async function readDeploymentFromJson(filePath: string): Promise<DeploymentTarget> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (
    parsed?.schemaVersion === DEPLOYMENT_EXTRACTED_METADATA_SCHEMA &&
    Array.isArray(parsed?.deployments) &&
    parsed.deployments.length === 1
  ) {
    return parsed.deployments[0] as DeploymentTarget;
  }
  return parsed as DeploymentTarget;
}

export async function resolveDeploymentForCli(
  workspaceRoot: string,
  requireFlag: (name: string) => string,
): Promise<DeploymentTarget> {
  const deploymentJson = getFlagStr("deployment-json", "").trim();
  if (deploymentJson) return await readDeploymentFromJson(deploymentJson);
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
  return path.join(outPath, "dist");
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
