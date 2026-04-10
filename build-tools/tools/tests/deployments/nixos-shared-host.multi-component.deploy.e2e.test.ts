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
      label: "//projects/deployments/demo-stack-dev:deploy",
      components: [
        {
          id: "frontend",
          kind: "static-webapp",
          target: "//projects/apps/demoapp:app",
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
          target: "//projects/apps/demoapi:app",
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
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeArtifact(frontendArtifact, "frontend");
    await writeArtifact(apiArtifact, "api");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
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
    try {
      const result = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --component-artifacts ${componentArtifactFlag({ frontend: frontendArtifact, api: apiArtifact })} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${recordsRoot} --host-config-out ${path.join(tmp, "rendered-host.json")} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      assert.deepEqual(
        summary.componentResults.map((component: { componentId: string }) => component.componentId),
        ["frontend", "api"],
      );
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
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
      const rendered = JSON.parse(await fsp.readFile(path.join(tmp, "rendered-host.json"), "utf8"));
      assert.ok(rendered.containers.demoapp);
      assert.ok(rendered.containers.demoapi);
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host multi-component deploy stops after the first publish failure", async () => {
  await runInTemp("nixos-shared-host-multi-component-failure", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      deploymentId: "demo-stack-dev",
      label: "//projects/deployments/demo-stack-dev:deploy",
      components: [
        {
          id: "frontend",
          kind: "static-webapp",
          target: "//projects/apps/demoapp:app",
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
          target: "//projects/apps/demoapi:app",
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
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeArtifact(frontendArtifact, "frontend");
    await fsp.mkdir(apiArtifact, { recursive: true });
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
      deployment,
    });
    const result = await $({
      cwd: tmp,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --component-artifacts ${componentArtifactFlag({ frontend: frontendArtifact, api: apiArtifact })} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${recordsRoot}`.nothrow();
    assert.notEqual((result as any).exitCode, 0);
    const runs = await fsp.readdir(path.join(recordsRoot, "runs"));
    const record = JSON.parse(await fsp.readFile(path.join(recordsRoot, "runs", runs[0]!), "utf8"));
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
  });
});
