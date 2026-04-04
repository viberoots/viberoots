#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import path from "node:path";
import { nodesFromCqueryJson } from "../buck/exporter/cquery/nodes.ts";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { resolveSelectedTargetLabel } from "../dev/target-label-resolver.ts";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { extractNixosSharedHostDeployments, type NixosSharedHostDeployment } from "./contract.ts";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane.ts";
import { maybeRunNixosSharedHostRemoteProfile } from "./nixos-shared-host-remote-cli.ts";
import { resolveNixosSharedHostReplaySelection } from "./nixos-shared-host-replay.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

const DEPLOYMENT_CQUERY_ATTRS = [
  "name",
  "rule_type",
  "provider",
  "component",
  "component_kind",
  "publisher",
  "provisioner",
  "protection_class",
  "app_name",
  "container_port",
  "health_path",
  "target_group",
  "labels",
];

function deploymentBuckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}

function deploymentIsolationArgs(): string[] {
  if (process.env.BUCK_NO_ISOLATION === "1") return [];
  const isolationDir = String(
    process.env.BUCK_ISOLATION_DIR ||
      process.env.BUCK_ISOLATION_DIR_EXPORTER ||
      process.env.BUCK_NESTED_ISO ||
      "",
  ).trim();
  return isolationDir ? ["--isolation-dir", isolationDir] : [];
}

async function queryDeploymentNodes(
  workspaceRoot: string,
  labels: string[],
): Promise<ReturnType<typeof nodesFromCqueryJson>> {
  const normalizedLabels = Array.from(new Set(labels.map((label) => normalizeTargetLabel(label))));
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const query = `set(${normalizedLabels.join(" ")})`;
  const { stdout } = await $({
    cwd: workspaceRoot,
    stdio: "pipe",
    env: deploymentBuckEnv(),
  })`buck2 ${deploymentIsolationArgs()} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
  return nodesFromCqueryJson(JSON.parse(String(stdout || "{}")) as Record<string, any>);
}

async function resolveDeploymentFromTarget(
  workspaceRoot: string,
  deploymentTarget: string,
): Promise<NixosSharedHostDeployment> {
  const deploymentNodes = await queryDeploymentNodes(workspaceRoot, [deploymentTarget]);
  const deploymentNode = deploymentNodes.find((node) => node.name === deploymentTarget);
  if (!deploymentNode) throw new Error(`deployment target not found: ${deploymentTarget}`);
  const componentTarget = normalizeTargetLabel(String((deploymentNode as any).component || ""));
  const nodes =
    componentTarget && componentTarget !== deploymentTarget
      ? await queryDeploymentNodes(workspaceRoot, [deploymentTarget, componentTarget])
      : deploymentNodes;
  const extracted = extractNixosSharedHostDeployments(nodes);
  if (extracted.errors.length > 0) throw new Error(extracted.errors.join("\n"));
  const hit = extracted.deployments.find((deployment) => deployment.label === deploymentTarget);
  if (!hit) throw new Error(`deployment target not found: ${deploymentTarget}`);
  return hit;
}

async function readDeploymentFromJson(filePath: string): Promise<NixosSharedHostDeployment> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (
    parsed?.version === 1 &&
    Array.isArray(parsed?.deployments) &&
    parsed.deployments.length === 1
  ) {
    return parsed.deployments[0] as NixosSharedHostDeployment;
  }
  return parsed as NixosSharedHostDeployment;
}

async function resolveDeployment(workspaceRoot: string): Promise<NixosSharedHostDeployment> {
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
  deployment: NixosSharedHostDeployment,
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
  if (await maybeRunNixosSharedHostRemoteProfile({ workspaceRoot, deployment })) return;
  const remove = getFlagBool("remove");
  const publishOnly = getFlagBool("publish-only");
  const rollback = getFlagBool("rollback");
  const sourceRunId = getFlagStr("source-run-id", "").trim();
  const artifactDirFlag = getFlagStr("artifact-dir", "").trim();
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
        operationKind: "explicit_removal",
        deployment,
        paths,
      })
    : await (async () => {
        const smokeConnectOverride = resolveSmokeConnectOverride();
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
            operationKind: replay.operationKind,
            deployment: replay.deployment,
            artifact: replay.artifact,
            publishBehavior: "publish-only",
            parentRunId: replay.parentRunId,
            releaseLineageId: replay.releaseLineageId,
            artifactLineageId: replay.artifactLineageId,
            paths,
            ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
          });
        }
        const artifactDir = await resolveArtifactDir(workspaceRoot, deployment);
        return await submitNixosSharedHostControlPlaneRun({
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
