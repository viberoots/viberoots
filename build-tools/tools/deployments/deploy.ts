#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { resolveSelectedTargetLabel } from "../dev/target-label-resolver.ts";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import { runFromChangesCli } from "./deployment-from-changes-cli.ts";
import { runCloudflarePagesCli } from "./cloudflare-pages-cli.ts";
import { resolveDeploymentFromTarget } from "./deployment-query.ts";
import { isNixosSharedHostDeployment, type DeploymentTarget } from "./contract.ts";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane.ts";
import { submitNixosSharedHostPublishOnlyRun } from "./nixos-shared-host-publish-only.ts";
import { maybeRunNixosSharedHostRemoteProfile } from "./nixos-shared-host-remote-cli.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

async function readDeploymentFromJson(filePath: string): Promise<DeploymentTarget> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (
    parsed?.version === 1 &&
    Array.isArray(parsed?.deployments) &&
    parsed.deployments.length === 1
  ) {
    return parsed.deployments[0] as DeploymentTarget;
  }
  return parsed as DeploymentTarget;
}

async function resolveDeployment(workspaceRoot: string): Promise<DeploymentTarget> {
  const deploymentJson = getFlagStr("deployment-json", "").trim();
  if (deploymentJson) return await readDeploymentFromJson(deploymentJson);
  const deploymentTarget = await resolveSelectedTargetLabel(
    workspaceRoot,
    requireFlag("deployment"),
    {
      baseDir: process.cwd(),
    },
  );
  return await resolveDeploymentFromTarget(workspaceRoot, deploymentTarget);
}

async function resolveArtifactDir(
  workspaceRoot: string,
  deployment: Pick<DeploymentTarget, "component">,
): Promise<string> {
  const artifactDir = getFlagStr("artifact-dir", "").trim();
  if (artifactDir) return path.resolve(artifactDir);
  const outPath = await buildSelectedOutPath(workspaceRoot, deployment.component.target);
  return path.join(outPath, "dist");
}

function resolveSmokeConnectOverride() {
  const smokeConnectHost = getFlagStr("smoke-connect-host", "").trim();
  const smokeConnectPort = Number(getFlagStr("smoke-connect-port", "").trim() || 0);
  const smokeConnectProtocol = getFlagStr("smoke-connect-protocol", "https:").trim();
  if (!smokeConnectHost || smokeConnectPort <= 0) return undefined;
  return {
    protocol: smokeConnectProtocol === "http:" ? ("http:" as const) : ("https:" as const),
    hostname: smokeConnectHost,
    port: smokeConnectPort,
    rejectUnauthorized: false,
  };
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  if (getFlagBool("from-changes")) {
    await runFromChangesCli(workspaceRoot);
    return;
  }
  const deployment = await resolveDeployment(workspaceRoot);
  const remove = getFlagBool("remove");
  const publishOnly = getFlagBool("publish-only");
  const preview = getFlagBool("preview");
  const previewCleanup = getFlagBool("preview-cleanup");
  const rollback = getFlagBool("rollback");
  const cleanupReason = getFlagStr("cleanup-reason", "manual_cleanup").trim();
  const sourceRunId = getFlagStr("source-run-id", "").trim();
  const artifactDirFlag = getFlagStr("artifact-dir", "").trim();
  const smokeConnectOverride = resolveSmokeConnectOverride();
  if (preview && previewCleanup) {
    throw new Error("--preview and --preview-cleanup are mutually exclusive");
  }
  if (preview && (publishOnly || remove || rollback)) {
    throw new Error("--preview cannot be combined with --publish-only, --remove, or --rollback");
  }
  if (previewCleanup && (publishOnly || remove || rollback)) {
    throw new Error(
      "--preview-cleanup cannot be combined with --publish-only, --remove, or --rollback",
    );
  }
  if (!isNixosSharedHostDeployment(deployment)) {
    if (remove) throw new Error("cloudflare-pages deploys do not support --remove yet");
    if (rollback) throw new Error("cloudflare-pages deploys do not support --rollback yet");
    const recordsRoot = path.resolve(
      getFlagStr(
        "records-root",
        path.join(workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
      ),
    );
    const resolvedArtifactDir =
      publishOnly || preview || previewCleanup
        ? undefined
        : await resolveArtifactDir(workspaceRoot, deployment);
    const result = await runCloudflarePagesCli({
      workspaceRoot,
      deployment,
      artifactDirFlag,
      resolvedArtifactDir,
      recordsRoot,
      publishOnly,
      preview,
      previewCleanup,
      sourceRunId,
      ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
      cleanupReason,
    });
    printJson(summarizeDeploymentResult(result));
    return;
  }
  if (preview || previewCleanup) {
    throw new Error("nixos-shared-host deploys do not support --preview or --preview-cleanup");
  }
  if (await maybeRunNixosSharedHostRemoteProfile({ workspaceRoot, deployment })) return;
  if (rollback && !publishOnly) throw new Error("--rollback requires --publish-only");
  if (remove && (publishOnly || rollback || sourceRunId)) {
    throw new Error(
      "--remove cannot be combined with --publish-only, --rollback, or --source-run-id",
    );
  }
  const hostRoot = path.resolve(
    getFlagStr("host-root", path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host")),
  );
  const statePath = path.resolve(getFlagStr("state", path.join(hostRoot, "platform-state.json")));
  const recordsRoot = path.resolve(getFlagStr("records-root", path.join(hostRoot, "records")));
  const hostConfigPath = getFlagStr("host-config-out", "").trim();
  const paths = {
    statePath,
    hostRoot,
    recordsRoot,
    ...(hostConfigPath ? { hostConfigPath: path.resolve(hostConfigPath) } : {}),
  };
  const result = remove
    ? await submitNixosSharedHostControlPlaneRun({
        workspaceRoot,
        operationKind: "explicit_removal",
        deployment,
        paths,
      })
    : await (async () => {
        if (publishOnly) {
          if (!sourceRunId) {
            throw new Error(
              rollback
                ? "shared rollback requires --source-run-id"
                : "shared --publish-only requires --source-run-id to select an admitted run",
            );
          }
          if (artifactDirFlag) {
            throw new Error(
              "shared --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
            );
          }
          return await submitNixosSharedHostPublishOnlyRun({
            workspaceRoot,
            deployment,
            paths,
            sourceRunId,
            rollback,
            ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
          });
        }
        const artifactDir = await resolveArtifactDir(workspaceRoot, deployment);
        return await submitNixosSharedHostControlPlaneRun({
          workspaceRoot,
          operationKind: "deploy",
          deployment,
          artifactDir,
          paths,
          ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
        });
      })();
  printJson(summarizeDeploymentResult(result));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
