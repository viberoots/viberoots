#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import path from "node:path";
import { ensureGraph } from "../buck/glue-run.ts";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { resolveSelectedTargetLabel } from "../dev/target-label-resolver.ts";
import { getFlagStr } from "../lib/cli.ts";
import { readCompositeGraph } from "../lib/graph-view.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { extractNixosSharedHostDeployments, type NixosSharedHostDeployment } from "./contract.ts";
import { runNixosSharedHostStaticDeploy } from "./nixos-shared-host-static-deploy.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
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
  await ensureGraph();
  const deploymentTarget = await resolveSelectedTargetLabel(
    workspaceRoot,
    requireFlag("deployment"),
    {
      baseDir: process.cwd(),
    },
  );
  const { nodes } = await readCompositeGraph({});
  const extracted = extractNixosSharedHostDeployments(nodes);
  if (extracted.errors.length > 0) throw new Error(extracted.errors.join("\n"));
  const hit = extracted.deployments.find((deployment) => deployment.label === deploymentTarget);
  if (!hit) throw new Error(`deployment target not found: ${deploymentTarget}`);
  return hit;
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

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const hostRoot = path.resolve(
    getFlagStr("host-root", path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host")),
  );
  const deployment = await resolveDeployment(workspaceRoot);
  const artifactDir = await resolveArtifactDir(workspaceRoot, deployment);
  const statePath = path.resolve(getFlagStr("state", path.join(hostRoot, "platform-state.json")));
  const recordsRoot = path.resolve(getFlagStr("records-root", path.join(hostRoot, "records")));
  const hostConfigPath = getFlagStr("host-config-out", "").trim();
  const smokeConnectHost = getFlagStr("smoke-connect-host", "").trim();
  const smokeConnectPort = Number(getFlagStr("smoke-connect-port", "").trim() || 0);
  const smokeConnectProtocol = getFlagStr("smoke-connect-protocol", "https:").trim();
  const result = await runNixosSharedHostStaticDeploy({
    deployment,
    artifactDir,
    statePath,
    hostRoot,
    recordsRoot,
    ...(hostConfigPath ? { hostConfigPath: path.resolve(hostConfigPath) } : {}),
    ...(smokeConnectHost && smokeConnectPort > 0
      ? {
          smokeConnectOverride: {
            protocol: smokeConnectProtocol === "http:" ? "http:" : "https:",
            hostname: smokeConnectHost,
            port: smokeConnectPort,
            rejectUnauthorized: false,
          },
        }
      : {}),
  });
  console.log(
    JSON.stringify(
      {
        runId: result.record.runId,
        finalOutcome: result.record.finalOutcome,
        artifactIdentity: result.record.artifactIdentity,
        publicUrl: result.record.publicUrl,
        recordPath: result.recordPath,
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
