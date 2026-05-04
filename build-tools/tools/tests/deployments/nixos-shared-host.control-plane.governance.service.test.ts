#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture";
import { readRecord, waitFor, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import { runInTemp } from "../lib/test-helpers";

async function deployWithChecks(opts: {
  tmp: string;
  $: any;
  deploymentLabel: string;
  artifactDir: string;
  controlPlaneUrl: string;
  serverPort: number;
  stageRevision: string;
}) {
  const result = await opts.$({
    cwd: opts.tmp,
    env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
    stdio: "pipe",
  })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${opts.deploymentLabel} --artifact-dir ${opts.artifactDir} --admit-and-deploy deploy/demo-dev --admit-for-commit ${opts.stageRevision} --control-plane-url ${opts.controlPlaneUrl} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(opts.serverPort)} --smoke-connect-protocol https:`;
  return JSON.parse(String(result.stdout));
}

test("service-backed shared-host deploy synthesizes service-owned governance evidence", async () => {
  await runInTemp("nixos-service-owned-governance", async (tmp, $) => {
    const deploymentLabel = "//sandbox/deployments/demo-dev:deploy";
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    await writeTempListedDeploymentWorkspace(tmp);
    await writeDemoArtifact(artifactDir);
    const deployment = await resolveDeploymentFromTarget(tmp, deploymentLabel);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    const stageRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse env/demo/dev`).stdout,
    ).trim();
    const server = await startNixosSharedHostPublicServer({
      deployment: deployment as any,
      hostRoot: paths.hostRoot,
    });
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      localFixture: true,
      env: {
        ...process.env,
        BNX_DEPLOY_GITHUB_GOVERNANCE_FIXTURE_JSON: JSON.stringify({
          scmBackend: "github",
          repository: deployment.lanePolicy.governance.repository,
          branchProtections: deployment.lanePolicy.governance.branchProtections,
        }),
      } as NodeJS.ProcessEnv,
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: paths.recordsRoot,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    });
    try {
      const summary = await deployWithChecks({
        tmp,
        $,
        deploymentLabel,
        artifactDir,
        controlPlaneUrl: controlPlane.url,
        serverPort: server.port,
        stageRevision,
      });
      const record = await waitFor(async () => {
        try {
          return await readRecord(controlPlane.url, summary.deployRunId);
        } catch {
          return null;
        }
      }, "timed out waiting for deploy record");
      assert.equal(
        record.admittedContext.policyEvaluation.laneGovernance.verificationSource,
        "service_verified",
      );
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
    }
  });
});

test("service-backed shared-host deploy fails closed when automatic governance drifts", async () => {
  await runInTemp("nixos-service-owned-governance-drift", async (tmp, $) => {
    const deploymentLabel = "//sandbox/deployments/demo-dev:deploy";
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    await writeTempListedDeploymentWorkspace(tmp);
    await writeDemoArtifact(artifactDir);
    const deployment = await resolveDeploymentFromTarget(tmp, deploymentLabel);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    const stageRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse env/demo/dev`).stdout,
    ).trim();
    const server = await startNixosSharedHostPublicServer({
      deployment: deployment as any,
      hostRoot: paths.hostRoot,
    });
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      localFixture: true,
      env: {
        ...process.env,
        BNX_DEPLOY_GITHUB_GOVERNANCE_FIXTURE_JSON: JSON.stringify({
          scmBackend: "github",
          repository: deployment.lanePolicy.governance.repository,
          branchProtections: deployment.lanePolicy.governance.branchProtections.map((entry) =>
            entry.stage === "dev" ? { ...entry, requiredChecks: [] } : entry,
          ),
        }),
      } as NodeJS.ProcessEnv,
    });
    try {
      await assert.rejects(
        deployWithChecks({
          tmp,
          $,
          deploymentLabel,
          artifactDir,
          controlPlaneUrl: controlPlane.url,
          serverPort: server.port,
          stageRevision,
        }),
        /lane governance verification failed[\s\S]*required checks drift/,
      );
    } finally {
      await controlPlane.close();
      await server.close();
    }
  });
});
