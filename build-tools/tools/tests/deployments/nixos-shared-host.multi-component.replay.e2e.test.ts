#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startStaticWebappHttpsMultiServer } from "./static-webapp.https-server.ts";

async function writeArtifact(root: string, name: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${name}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

function componentArtifactFlag(artifacts: Record<string, string>): string {
  return Object.entries(artifacts)
    .map(([componentId, artifactDir]) => `${componentId}=${artifactDir}`)
    .join(",");
}

function liveRootPath(hostRoot: string, containerName: string): string {
  return path.join(nixosSharedHostContainerRoot(hostRoot, containerName), "srv/static-app/live");
}

function liveIndexPath(hostRoot: string, containerName: string): string {
  return path.join(liveRootPath(hostRoot, containerName), "index.html");
}

function multiComponentDeployment(
  environmentStage: "dev" | "staging" = "dev",
  namePrefix = "demo",
) {
  const admissionPolicy =
    environmentStage === "staging"
      ? nixosSharedHostAdmissionPolicyFixture({
          ref: `//projects/deployments/${namePrefix}-shared:staging_release`,
          name: "staging_release",
          allowedRefs: ["env/pleomino/staging"],
          requiredChecks: [],
          fingerprint: `sha256:admission-${namePrefix}-staging`,
        })
      : nixosSharedHostAdmissionPolicyFixture({
          allowedRefs: ["env/pleomino/dev"],
          requiredChecks: [],
          fingerprint: `sha256:admission-${namePrefix}-dev`,
        });
  return nixosSharedHostDeploymentFixture({
    deploymentId: `${namePrefix}-stack-${environmentStage}`,
    label: `//projects/deployments/${namePrefix}-stack-${environmentStage}:deploy`,
    environmentStage,
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    components: [
      {
        id: "frontend",
        kind: "static-webapp",
        target: "//projects/apps/demoapp:app",
        runtime: {
          appName: `${namePrefix}-frontend-${environmentStage}`,
          containerPort: 3000,
          healthPath: "/healthz",
        },
        providerTarget: {
          host: "nixos-shared-host",
          targetGroup: "default",
          appNames: [`${namePrefix}-frontend-${environmentStage}`],
          deploymentTargetIdentity: `nixos-shared-host:default:${namePrefix}-frontend-${environmentStage}`,
          appName: `${namePrefix}-frontend-${environmentStage}`,
          hostname: `${namePrefix}-frontend-${environmentStage}.apps.kilty.io`,
          containerName: `${namePrefix}-frontend-${environmentStage}`,
          sharedDevTargetIdentity: `nixos-shared-host:default:${namePrefix}-frontend-${environmentStage}`,
        },
      },
      {
        id: "api",
        kind: "static-webapp",
        target: "//projects/apps/demoapi:app",
        runtime: {
          appName: `${namePrefix}-api-${environmentStage}`,
          containerPort: 3001,
          healthPath: "/healthz",
        },
        providerTarget: {
          host: "nixos-shared-host",
          targetGroup: "default",
          appNames: [`${namePrefix}-api-${environmentStage}`],
          deploymentTargetIdentity: `nixos-shared-host:default:${namePrefix}-api-${environmentStage}`,
          appName: `${namePrefix}-api-${environmentStage}`,
          hostname: `${namePrefix}-api-${environmentStage}.apps.kilty.io`,
          containerName: `${namePrefix}-api-${environmentStage}`,
          sharedDevTargetIdentity: `nixos-shared-host:default:${namePrefix}-api-${environmentStage}`,
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
}

test("nixos-shared-host multi-component retry reuses a live proven component and republishes the failed one", async () => {
  await runInTemp("nixos-shared-host-multi-component-retry", async (tmp, $) => {
    const deployment = multiComponentDeployment();
    const deploymentJson = path.join(tmp, "deployment.json");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeArtifact(frontendArtifact, "frontend-v1");
    await writeArtifact(apiArtifact, "api-v1");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    let serveFrontend = false;
    const server = await startStaticWebappHttpsMultiServer({
      hosts: {
        [`${deployment.components[0]!.runtime.appName}.apps.kilty.io`]: () =>
          serveFrontend
            ? liveRootPath(hostRoot, deployment.components[0]!.runtime.appName)
            : path.join(tmp, ".missing-frontend"),
        [`${deployment.components[1]!.runtime.appName}.apps.kilty.io`]: () =>
          liveRootPath(hostRoot, deployment.components[1]!.runtime.appName),
      },
      tlsRoot: hostRoot,
    });
    try {
      const failed = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --component-artifacts ${componentArtifactFlag({ frontend: frontendArtifact, api: apiArtifact })} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
      assert.notEqual(failed.exitCode, 0);
      const [failedRecordName] = (await fsp.readdir(path.join(recordsRoot, "runs"))).sort();
      const failedRecord = JSON.parse(
        await fsp.readFile(path.join(recordsRoot, "runs", failedRecordName!), "utf8"),
      );
      serveFrontend = true;
      await fsp.writeFile(
        liveIndexPath(hostRoot, deployment.components[1]!.runtime.appName),
        "<html>tampered-api</html>\n",
        "utf8",
      );
      await fsp.rm(frontendArtifact, { recursive: true, force: true });
      await fsp.rm(apiArtifact, { recursive: true, force: true });
      const retry = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --publish-only --source-run-id ${failedRecord.deployRunId} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(retry.stdout));
      assert.equal(summary.operationKind, "retry");
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      const frontend = record.componentResults.find(
        (result: any) => result.componentId === "frontend",
      );
      const api = record.componentResults.find((result: any) => result.componentId === "api");
      assert.equal(frontend.publishState.mode, "reused_live_identity");
      assert.equal(frontend.publishState.liveArtifactIdentity, frontend.artifactIdentity);
      assert.equal(api.publishState.mode, "published");
      assert.match(
        await fsp.readFile(
          liveIndexPath(hostRoot, deployment.components[0]!.runtime.appName),
          "utf8",
        ),
        /frontend-v1/,
      );
      assert.match(
        await fsp.readFile(
          liveIndexPath(hostRoot, deployment.components[1]!.runtime.appName),
          "utf8",
        ),
        /api-v1/,
      );
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host multi-component rollback replays recorded per-component exact artifacts", async () => {
  await runInTemp("nixos-shared-host-multi-component-rollback", async (tmp, $) => {
    const deployment = multiComponentDeployment();
    const deploymentJson = path.join(tmp, "deployment.json");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const frontendV1 = path.join(tmp, "artifacts", "frontend-v1");
    const apiV1 = path.join(tmp, "artifacts", "api-v1");
    const frontendV2 = path.join(tmp, "artifacts", "frontend-v2");
    const apiV2 = path.join(tmp, "artifacts", "api-v2");
    await writeArtifact(frontendV1, "frontend-v1");
    await writeArtifact(apiV1, "api-v1");
    await writeArtifact(frontendV2, "frontend-v2");
    await writeArtifact(apiV2, "api-v2");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const server = await startStaticWebappHttpsMultiServer({
      hosts: {
        [`${deployment.components[0]!.runtime.appName}.apps.kilty.io`]: () =>
          liveRootPath(hostRoot, deployment.components[0]!.runtime.appName),
        [`${deployment.components[1]!.runtime.appName}.apps.kilty.io`]: () =>
          liveRootPath(hostRoot, deployment.components[1]!.runtime.appName),
      },
      tlsRoot: hostRoot,
    });
    try {
      const first = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --component-artifacts ${componentArtifactFlag({ frontend: frontendV1, api: apiV1 })} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(first.stdout));
      await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --component-artifacts ${componentArtifactFlag({ frontend: frontendV2, api: apiV2 })} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      await fsp.rm(path.join(tmp, "artifacts"), { recursive: true, force: true });
      const rollback = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --publish-only --source-run-id ${firstSummary.deployRunId} --rollback --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(rollback.stdout));
      assert.equal(summary.operationKind, "rollback");
      assert.match(
        await fsp.readFile(
          liveIndexPath(hostRoot, deployment.components[0]!.runtime.appName),
          "utf8",
        ),
        /frontend-v1/,
      );
      assert.match(
        await fsp.readFile(
          liveIndexPath(hostRoot, deployment.components[1]!.runtime.appName),
          "utf8",
        ),
        /api-v1/,
      );
    } finally {
      await server.close();
    }
  });
});
