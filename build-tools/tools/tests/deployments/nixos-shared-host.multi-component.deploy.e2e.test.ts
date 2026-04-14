#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import {
  readRecord,
  readStatus,
  startControlPlaneHarness,
  submitServiceRequest,
  waitFor,
} from "./nixos-shared-host.control-plane.helpers.ts";
import { startStaticWebappHttpsMultiServer } from "./static-webapp.https-server.ts";

async function writeArtifact(root: string, name: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${name}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

function componentArtifactFlag(artifacts: Record<string, string>): string {
  return Object.entries(artifacts)
    .map(([componentId, artifactDir]) => `${componentId}=${artifactDir}`)
    .join(",");
}

test("nixos-shared-host multi-component deploy publishes components in rollout order", async () => {
  await runInTemp("nixos-shared-host-multi-component", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      deploymentId: "demo-stack-dev",
      label: "//test-workspace/deployments/demo-stack-dev:deploy",
      components: [
        {
          id: "frontend",
          kind: "static-webapp",
          target: "//test-workspace/apps/demoapp:app",
          runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
          providerTarget: {
            host: "nixos-shared-host",
            targetGroup: "default",
            appNames: ["demoapp"],
            deploymentTargetIdentity: "nixos-shared-host:default:demoapp",
            appName: "demoapp",
            hostname: "demoapp.apps.kilty.io",
            containerName: "demoapp",
            sharedDevTargetIdentity: "nixos-shared-host:default:demoapp",
          },
        },
        {
          id: "api",
          kind: "static-webapp",
          target: "//test-workspace/apps/demoapi:app",
          runtime: { appName: "demoapi", containerPort: 3001, healthPath: "/healthz" },
          providerTarget: {
            host: "nixos-shared-host",
            targetGroup: "default",
            appNames: ["demoapi"],
            deploymentTargetIdentity: "nixos-shared-host:default:demoapi",
            appName: "demoapi",
            hostname: "demoapi.apps.kilty.io",
            containerName: "demoapi",
            sharedDevTargetIdentity: "nixos-shared-host:default:demoapi",
          },
        },
      ],
      rolloutPolicy: {
        mode: "ordered_best_effort",
        abort: "stop_on_first_failure",
        smoke: "final_only",
        steps: ["frontend", "api"],
      },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const statePath = path.join(tmp, "platform-state.json");
    const hostConfigPath = path.join(tmp, "rendered-host.json");
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeArtifact(frontendArtifact, "frontend");
    await writeArtifact(apiArtifact, "api");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const server = await startStaticWebappHttpsMultiServer({
      hosts: {
        "demoapp.apps.kilty.io": () =>
          path.join(nixosSharedHostContainerRoot(hostRoot, "demoapp"), "srv/static-app/live"),
        "demoapi.apps.kilty.io": () =>
          path.join(nixosSharedHostContainerRoot(hostRoot, "demoapi"), "srv/static-app/live"),
      },
      tlsRoot: hostRoot,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
      hostConfigPath,
    });
    try {
      const result = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --component-artifacts ${componentArtifactFlag({ frontend: frontendArtifact, api: apiArtifact })} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      assert.deepEqual(
        summary.componentResults.map((component: { componentId: string }) => component.componentId),
        ["frontend", "api"],
      );
      const record = await readRecord(harness.controlPlane.url, summary.deployRunId);
      assert.equal(record.providerTargetIdentity, "nixos-shared-host:default:{demoapi,demoapp}");
      assert.deepEqual(
        record.componentResults.map((component: { componentId: string; finalOutcome: string }) => ({
          componentId: component.componentId,
          finalOutcome: component.finalOutcome,
        })),
        [
          { componentId: "frontend", finalOutcome: "succeeded" },
          { componentId: "api", finalOutcome: "succeeded" },
        ],
      );
      const rendered = JSON.parse(await fsp.readFile(hostConfigPath, "utf8"));
      assert.ok(rendered.containers.demoapp);
      assert.ok(rendered.containers.demoapi);
    } finally {
      await harness.close();
      await server.close();
    }
  });
});

test("nixos-shared-host multi-component deploy stops after the first publish failure", async () => {
  await runInTemp("nixos-shared-host-multi-component-failure", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      deploymentId: "demo-stack-dev",
      label: "//test-workspace/deployments/demo-stack-dev:deploy",
      components: [
        {
          id: "frontend",
          kind: "static-webapp",
          target: "//test-workspace/apps/demoapp:app",
          runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
          providerTarget: {
            host: "nixos-shared-host",
            targetGroup: "default",
            appNames: ["demoapp"],
            deploymentTargetIdentity: "nixos-shared-host:default:demoapp",
            appName: "demoapp",
            hostname: "demoapp.apps.kilty.io",
            containerName: "demoapp",
            sharedDevTargetIdentity: "nixos-shared-host:default:demoapp",
          },
        },
        {
          id: "api",
          kind: "static-webapp",
          target: "//test-workspace/apps/demoapi:app",
          runtime: { appName: "demoapi", containerPort: 3001, healthPath: "/healthz" },
          providerTarget: {
            host: "nixos-shared-host",
            targetGroup: "default",
            appNames: ["demoapi"],
            deploymentTargetIdentity: "nixos-shared-host:default:demoapi",
            appName: "demoapi",
            hostname: "demoapi.apps.kilty.io",
            containerName: "demoapi",
            sharedDevTargetIdentity: "nixos-shared-host:default:demoapi",
          },
        },
      ],
      rolloutPolicy: {
        mode: "ordered_best_effort",
        abort: "stop_on_first_failure",
        smoke: "final_only",
        steps: ["frontend", "api"],
      },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const statePath = path.join(tmp, "platform-state.json");
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeArtifact(frontendArtifact, "frontend");
    await fsp.mkdir(apiArtifact, { recursive: true });
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
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
    const submitted = await submitServiceRequest({
      url: harness.controlPlane.url,
      deployment,
      artifactDirsByComponentId: { frontend: frontendArtifact, api: apiArtifact },
      admissionEvidence: JSON.parse(await fsp.readFile(admissionEvidenceJson, "utf8")),
    });
    const status = await waitFor(async () => {
      const current = await readStatus(harness.controlPlane.url, submitted.submissionId);
      return current.lifecycleState === "finished" ? current : null;
    }, "timed out waiting for multi-component failure result");
    const record = await readRecord(harness.controlPlane.url, status.deployRunId);
    assert.equal(record.finalOutcome, "publish_failed");
    assert.deepEqual(
      record.componentResults.map((component: { componentId: string; finalOutcome: string }) => ({
        componentId: component.componentId,
        finalOutcome: component.finalOutcome,
      })),
      [
        { componentId: "frontend", finalOutcome: "succeeded" },
        { componentId: "api", finalOutcome: "publish_failed" },
      ],
    );
    await harness.close();
  });
});
