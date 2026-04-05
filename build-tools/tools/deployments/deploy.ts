#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { resolveSelectedTargetLabel } from "../dev/target-label-resolver.ts";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { submitCloudflarePagesControlPlaneDeploy } from "./cloudflare-pages-control-plane.ts";
import { resolveCloudflarePagesPromotionSelection } from "./cloudflare-pages-promotion.ts";
import { resolveDeploymentFromTarget } from "./deployment-query.ts";
import { isNixosSharedHostDeployment, type DeploymentTarget } from "./contract.ts";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane.ts";
import { maybeRunNixosSharedHostRemoteProfile } from "./nixos-shared-host-remote-cli.ts";
import { resolveNixosSharedHostReplaySelection } from "./nixos-shared-host-replay.ts";

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

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const deployment = await resolveDeployment(workspaceRoot);
  const remove = getFlagBool("remove");
  const publishOnly = getFlagBool("publish-only");
  const rollback = getFlagBool("rollback");
  const sourceRunId = getFlagStr("source-run-id", "").trim();
  const artifactDirFlag = getFlagStr("artifact-dir", "").trim();
  const smokeConnectOverride = resolveSmokeConnectOverride();
  if (!isNixosSharedHostDeployment(deployment)) {
    if (remove) throw new Error("cloudflare-pages deploys do not support --remove yet");
    if (rollback) throw new Error("cloudflare-pages deploys do not support --rollback yet");
    const recordsRoot = path.resolve(
      getFlagStr(
        "records-root",
        path.join(workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
      ),
    );
    if (publishOnly && !sourceRunId) {
      throw new Error(
        "cloudflare-pages --publish-only requires --source-run-id to select a promotion source run",
      );
    }
    if (!publishOnly && sourceRunId) {
      throw new Error("cloudflare-pages --source-run-id requires --publish-only");
    }
    if (publishOnly && artifactDirFlag) {
      throw new Error(
        "cloudflare-pages --publish-only must not use --artifact-dir; promote the admitted exact artifact with --source-run-id",
      );
    }
    const promotion = publishOnly
      ? await resolveCloudflarePagesPromotionSelection({
          workspaceRoot,
          deployment,
          recordsRoot,
          sourceRunId,
        })
      : undefined;
    const result = await submitCloudflarePagesControlPlaneDeploy({
      workspaceRoot,
      deployment,
      recordsRoot,
      ...(promotion
        ? {
            operationKind: promotion.operationKind,
            artifact: promotion.artifact,
            publishBehavior: "publish-only" as const,
            parentRunId: promotion.parentRunId,
            releaseLineageId: promotion.releaseLineageId,
            artifactLineageId: promotion.artifactLineageId,
            source: {
              record: promotion.sourceRecord,
              recordPath: promotion.sourceRecordPath,
              replaySnapshotPath: promotion.sourceReplaySnapshotPath,
            },
          }
        : {
            artifactDir: await resolveArtifactDir(workspaceRoot, deployment),
          }),
      ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
    });
    console.log(
      JSON.stringify(
        {
          runId: result.record.deployRunId,
          deployRunId: result.record.deployRunId,
          operationKind: result.record.operationKind,
          runClassification: result.record.runClassification,
          finalOutcome: result.record.finalOutcome,
          artifactIdentity: result.record.artifact?.identity,
          ...(result.record.parentRunId ? { parentRunId: result.record.parentRunId } : {}),
          publicUrl: result.record.publicUrl,
          recordPath: result.recordPath,
          ...(result.record.controlPlane ? { controlPlane: result.record.controlPlane } : {}),
        },
        null,
        2,
      ),
    );
    return;
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
          const replay = await resolveNixosSharedHostReplaySelection({
            deployment,
            recordsRoot,
            sourceRunId,
            rollback,
          });
          return await submitNixosSharedHostControlPlaneRun({
            workspaceRoot,
            operationKind: replay.operationKind,
            deployment: replay.deployment,
            artifact: replay.artifact,
            publishBehavior: "publish-only",
            parentRunId: replay.parentRunId,
            releaseLineageId: replay.releaseLineageId,
            artifactLineageId: replay.artifactLineageId,
            source: {
              record: replay.sourceRecord,
              replaySnapshot: replay.sourceReplaySnapshot,
            },
            paths,
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
  console.log(
    JSON.stringify(
      {
        runId: result.record.deployRunId,
        deployRunId: result.record.deployRunId,
        operationKind: result.record.operationKind,
        runClassification: result.record.runClassification,
        finalOutcome: result.record.finalOutcome,
        artifactIdentity: result.record.artifact?.identity,
        ...(result.record.parentRunId ? { parentRunId: result.record.parentRunId } : {}),
        publicUrl: result.record.publicUrl,
        recordPath: result.recordPath,
        ...(result.record.controlPlane ? { controlPlane: result.record.controlPlane } : {}),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
