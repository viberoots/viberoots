#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startControlPlaneHarness } from "./nixos-shared-host.control-plane.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

async function writeArtifact(root: string, marker: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${marker}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

test("nixos-shared-host rollback fails closed for a successful retry source run", async () => {
  await runInTemp("nixos-shared-host-rollback-guardrails", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const commandEnv = {
      ...process.env,
      VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    await writeArtifact(artifactDir, "v1");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const first = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(first.stdout));
      const retry = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${firstSummary.deployRunId} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const retrySummary = JSON.parse(String(retry.stdout));
      const rollback = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${retrySummary.deployRunId} --rollback --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
      assert.notEqual(rollback.exitCode, 0);
      assert.match(String(rollback.stderr), /rollback source run is not eligible/);
      assert.match(String(rollback.stderr), /wrong run classification: retry/);
    } finally {
      await harness.close();
      await server.close();
    }
  });
});
