#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  installNixosSharedHostTargets,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";

async function prepareSameHostFixture(tmp: string, $: any) {
  const deployment = nixosSharedHostDeploymentFixture({
    runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
  });
  const artifactDir = path.join(tmp, "artifact");
  const paths = {
    statePath: path.join(tmp, "platform-state.json"),
    hostRoot: path.join(tmp, "host"),
    recordsRoot: path.join(tmp, "records"),
  };
  await installNixosSharedHostTargets(tmp, [deployment]);
  await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
  await writeDemoArtifact(artifactDir);
  const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
    tmp,
    $,
    deploymentLabel: deployment.label,
    deployment,
  });
  return { deployment, artifactDir, admissionEvidenceJson, paths };
}

async function runDeployCli(
  $: any,
  tmp: string,
  deploymentLabel: string,
  admissionEvidenceJson: string,
  extraArgs: string[],
) {
  return await $({
    cwd: tmp,
    env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
    stdio: "pipe",
  })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deploymentLabel} --admission-evidence-json ${admissionEvidenceJson} ${extraArgs}`.nothrow();
}

test("repo deploy CLI fails closed on missing same-host service endpoint for every reviewed mutation kind", async () => {
  await runInTemp("nixos-shared-host-service-only-missing-endpoint", async (tmp, $) => {
    const { deployment, artifactDir, admissionEvidenceJson } = await prepareSameHostFixture(tmp, $);
    const cases = [
      { operation: "deploy", extraArgs: ["--artifact-dir", artifactDir] },
      { operation: "provision-only", extraArgs: ["--provision-only"] },
      { operation: "publish-only", extraArgs: ["--publish-only", "--source-run-id", "run-123"] },
      { operation: "explicit-removal", extraArgs: ["--remove"] },
    ];
    for (const testCase of cases) {
      const result = await runDeployCli(
        $,
        tmp,
        deployment.label,
        admissionEvidenceJson,
        testCase.extraArgs,
      );
      assert.notEqual(result.exitCode, 0, testCase.operation);
      assert.match(
        String(result.stderr),
        /requires --control-plane-url or VBR_DEPLOY_CONTROL_PLANE_URL/,
        testCase.operation,
      );
    }
  });
});

test("repo deploy CLI fails closed when the same-host control-plane service requires auth and no token is supplied", async () => {
  await runInTemp("nixos-shared-host-service-only-missing-auth", async (tmp, $) => {
    const { deployment, artifactDir, admissionEvidenceJson, paths } = await prepareSameHostFixture(
      tmp,
      $,
    );
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      token: "required-token",
    });
    try {
      const result = await runDeployCli($, tmp, deployment.label, admissionEvidenceJson, [
        "--artifact-dir",
        artifactDir,
        "--control-plane-url",
        controlPlane.url,
      ]);
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /unauthorized/);
    } finally {
      await controlPlane.close();
    }
  });
});

test("repo deploy CLI fails closed when the same-host control-plane service is unavailable", async () => {
  await runInTemp("nixos-shared-host-service-only-unavailable", async (tmp, $) => {
    const { deployment, artifactDir, admissionEvidenceJson } = await prepareSameHostFixture(tmp, $);
    const result = await runDeployCli($, tmp, deployment.label, admissionEvidenceJson, [
      "--artifact-dir",
      artifactDir,
      "--control-plane-url",
      "http://127.0.0.1:9",
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /control-plane service unavailable/);
  });
});
