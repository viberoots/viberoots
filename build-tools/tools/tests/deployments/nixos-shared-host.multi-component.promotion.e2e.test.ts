#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startControlPlaneHarness } from "./nixos-shared-host.control-plane.helpers";
import { startStaticWebappHttpsMultiServer } from "./static-webapp.https-server";

async function writeArtifact(root: string, marker: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${marker}</html>\n`, "utf8");
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

function liveIndexPath(hostRoot: string, containerName: string): string {
  return path.join(
    nixosSharedHostContainerRoot(hostRoot, containerName),
    "srv/static-app/live/index.html",
  );
}

function deploymentFor(environmentStage: "dev" | "staging", prefix: string) {
  const admissionPolicy =
    environmentStage === "staging"
      ? nixosSharedHostAdmissionPolicyFixture({
          ref: `//projects/deployments/${prefix}:staging_release`,
          name: "staging_release",
          allowedRefs: ["env/pleomino/staging"],
          requiredChecks: ["deploy/pleomino-staging"],
          fingerprint: `sha256:${prefix}-staging`,
        })
      : nixosSharedHostAdmissionPolicyFixture({
          allowedRefs: ["env/pleomino/dev"],
          requiredChecks: ["deploy/pleomino-dev"],
          fingerprint: `sha256:${prefix}-dev`,
        });
  return nixosSharedHostDeploymentFixture({
    deploymentId: `${prefix}-${environmentStage}`,
    label: `//projects/deployments/${prefix}-${environmentStage}:deploy`,
    environmentStage,
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    components: [
      {
        id: "frontend",
        kind: "static-webapp",
        target: "//projects/apps/pleomino:app",
        runtime: {
          appName: `${prefix}-frontend-${environmentStage}`,
          containerPort: 3000,
          healthPath: "/healthz",
        },
        providerTarget: {
          host: "nixos-shared-host",
          targetGroup: "default",
          appNames: [`${prefix}-frontend-${environmentStage}`],
          deploymentTargetIdentity: `nixos-shared-host:default:${prefix}-frontend-${environmentStage}`,
          appName: `${prefix}-frontend-${environmentStage}`,
          hostname: `${prefix}-frontend-${environmentStage}.apps.kilty.io`,
          containerName: `${prefix}-frontend-${environmentStage}`,
          sharedDevTargetIdentity: `nixos-shared-host:default:${prefix}-frontend-${environmentStage}`,
        },
      },
      {
        id: "api",
        kind: "static-webapp",
        target: "//projects/apps/pleomino-api:app",
        runtime: {
          appName: `${prefix}-api-${environmentStage}`,
          containerPort: 3001,
          healthPath: "/healthz",
        },
        providerTarget: {
          host: "nixos-shared-host",
          targetGroup: "default",
          appNames: [`${prefix}-api-${environmentStage}`],
          deploymentTargetIdentity: `nixos-shared-host:default:${prefix}-api-${environmentStage}`,
          appName: `${prefix}-api-${environmentStage}`,
          hostname: `${prefix}-api-${environmentStage}.apps.kilty.io`,
          containerName: `${prefix}-api-${environmentStage}`,
          sharedDevTargetIdentity: `nixos-shared-host:default:${prefix}-api-${environmentStage}`,
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

test("nixos-shared-host multi-component promotion reuses recorded per-component exact artifacts", async () => {
  await runInTemp("nixos-shared-host-multi-component-promotion", async (tmp, $) => {
    const source = deploymentFor("dev", "promote-stack");
    const target = deploymentFor("staging", "promote-stack");
    const sourceJson = path.join(tmp, "source.json");
    const targetJson = path.join(tmp, "target.json");
    const recordsRoot = path.join(tmp, "records");
    const statePath = path.join(tmp, "platform-state.json");
    const hostRoot = path.join(tmp, "host");
    const bootstrapFrontend = path.join(tmp, "bootstrap", "frontend");
    const bootstrapApi = path.join(tmp, "bootstrap", "api");
    const sourceFrontend = path.join(tmp, "source-artifacts", "frontend");
    const sourceApi = path.join(tmp, "source-artifacts", "api");
    await writeArtifact(bootstrapFrontend, "bootstrap-frontend");
    await writeArtifact(bootstrapApi, "bootstrap-api");
    await writeArtifact(sourceFrontend, "promoted-frontend");
    await writeArtifact(sourceApi, "promoted-api");
    await ensureNixosSharedHostStageBranch(tmp, $, source);
    await ensureNixosSharedHostStageBranch(tmp, $, target);
    await writeDeploymentJson(sourceJson, source);
    await writeDeploymentJson(targetJson, target);
    const sourceEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: source.label,
      deployment: source,
      includeRequiredChecks: true,
    });
    const targetEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: target.label,
      deployment: target,
      includeRequiredChecks: true,
    });
    const server = await startStaticWebappHttpsMultiServer({
      hosts: {
        [`${source.components[0]!.runtime.appName}.apps.kilty.io`]: () =>
          path.join(
            nixosSharedHostContainerRoot(hostRoot, source.components[0]!.runtime.appName),
            "srv/static-app/live",
          ),
        [`${source.components[1]!.runtime.appName}.apps.kilty.io`]: () =>
          path.join(
            nixosSharedHostContainerRoot(hostRoot, source.components[1]!.runtime.appName),
            "srv/static-app/live",
          ),
        [`${target.components[0]!.runtime.appName}.apps.kilty.io`]: () =>
          path.join(
            nixosSharedHostContainerRoot(hostRoot, target.components[0]!.runtime.appName),
            "srv/static-app/live",
          ),
        [`${target.components[1]!.runtime.appName}.apps.kilty.io`]: () =>
          path.join(
            nixosSharedHostContainerRoot(hostRoot, target.components[1]!.runtime.appName),
            "srv/static-app/live",
          ),
      },
      tlsRoot: hostRoot,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
    });
    try {
      await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${target.label} --admission-evidence-json ${targetEvidenceJson} --component-artifacts ${componentArtifactFlag({ frontend: bootstrapFrontend, api: bootstrapApi })} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const sourceRun = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${source.label} --admission-evidence-json ${sourceEvidenceJson} --component-artifacts ${componentArtifactFlag({ frontend: sourceFrontend, api: sourceApi })} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const sourceSummary = JSON.parse(String(sourceRun.stdout));
      await fsp.rm(path.join(tmp, "source-artifacts"), { recursive: true, force: true });
      const promotion = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${target.label} --admission-evidence-json ${targetEvidenceJson} --publish-only --source-run-id ${sourceSummary.deployRunId} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(promotion.stdout));
      assert.equal(summary.operationKind, "promotion");
      assert.match(
        await fsp.readFile(liveIndexPath(hostRoot, target.components[0]!.runtime.appName), "utf8"),
        /promoted-frontend/,
      );
      assert.match(
        await fsp.readFile(liveIndexPath(hostRoot, target.components[1]!.runtime.appName), "utf8"),
        /promoted-api/,
      );
    } finally {
      await harness.close();
      await server.close();
    }
  });
});
