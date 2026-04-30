#!/usr/bin/env zx-wrapper
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { resolveSelectedTargetLabel } from "../dev/target-label-resolver.ts";
import { getFlagStr, getPositionalsWithValueFlags } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
import { resolveDeploymentFromTarget } from "./deployment-query.ts";
import {
  artifactDirFromBuiltOutPath,
  buildArtifactDirsByComponentId,
  parseComponentArtifactDirs,
} from "./deployment-component-artifact-dirs.ts";

const DEPLOY_POSITIONAL_PRECEDING_VALUE_FLAGS = [
  "admission-evidence-json",
  "admit-and-deploy",
  "admit-for-commit",
  "admit-only",
  "artifact-dir",
  "cleanup-reason",
  "component-artifacts",
  "control-plane-token",
  "control-plane-url",
  "deployment-json",
  "mark-check-for-commit",
  "mark-check-passed",
  "deployment",
  "destination",
  "profile",
  "profile-root",
  "remote-config-root",
  "remote-managed-root",
  "remote-records-root",
  "remote-repo-path",
  "remote-runtime-root",
  "remote-state-path",
  "remote",
  "smoke-connect-host",
  "smoke-connect-port",
  "smoke-connect-protocol",
  "source-run-id",
  "ssh-mode",
  "target-exception",
];

function isDeploymentSelector(value: string): boolean {
  const s = value.trim();
  return Boolean(
    s &&
      (s.startsWith("//") ||
        s.startsWith("root//") ||
        s.startsWith(":") ||
        s === "." ||
        s.startsWith("./") ||
        s.startsWith("../") ||
        s.startsWith("/") ||
        s.includes("/")),
  );
}

function deploymentSelectorFromCli(requireFlag: (name: string) => string): string {
  const explicit = getFlagStr("deployment", "").trim();
  const positionals = getPositionalsWithValueFlags(DEPLOY_POSITIONAL_PRECEDING_VALUE_FLAGS)
    .map((value) => value.trim())
    .filter(isDeploymentSelector);
  if (explicit && positionals.length > 0) {
    throw new Error("--deployment cannot be combined with a positional deployment selector");
  }
  if (positionals.length > 1) {
    throw new Error(
      `deploy accepts one positional deployment selector, got: ${positionals.join(" ")}`,
    );
  }
  return explicit || positionals[0] || requireFlag("deployment");
}

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
  const selectedTarget = await resolveSelectedTargetLabel(
    workspaceRoot,
    deploymentSelectorFromCli(requireFlag),
    { baseDir: process.cwd(), preferredTargetName: "deploy" },
  );
  const deploymentTarget =
    selectedTarget.startsWith("//") && !selectedTarget.includes(":")
      ? `${selectedTarget}:deploy`
      : selectedTarget;
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
