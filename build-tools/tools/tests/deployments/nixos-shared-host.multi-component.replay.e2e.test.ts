#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";
import { multiComponentDeployment } from "./nixos-shared-host.multi-component.fixture";
import {
  readRecord,
  readStatus,
  startControlPlaneHarness,
  submitServiceRequest,
  waitFor,
} from "./nixos-shared-host.control-plane.helpers";
import {
  componentArtifactFlag,
  liveIndexPath,
  liveRootPath,
  writeArtifact,
  writeDeploymentJson,
} from "./nixos-shared-host.reuse.e2e.helpers";
import { startStaticWebappHttpsMultiServer } from "./static-webapp.https-server";

test("nixos-shared-host multi-component retry reuses a live proven component and republishes the failed one", async () => {
  await runInTemp("nixos-shared-host-multi-component-retry", async (tmp, $) => {
    const deployment = multiComponentDeployment();
    const deploymentJson = path.join(tmp, "deployment.json");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const statePath = path.join(tmp, "platform-state.json");
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeArtifact(frontendArtifact, "frontend-v1");
    await writeArtifact(apiArtifact, "api-v1");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
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
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
    });
    try {
      const submitted = await submitServiceRequest({
        url: harness.controlPlane.url,
        deployment,
        artifactDirsByComponentId: { frontend: frontendArtifact, api: apiArtifact },
        admissionEvidence: JSON.parse(await fsp.readFile(admissionEvidenceJson, "utf8")),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const finished = await waitFor(async () => {
        const current = await readStatus(harness.controlPlane.url, submitted.submissionId);
        return current.lifecycleState === "finished" ? current : null;
      }, "timed out waiting for multi-component retry seed failure");
      assert.equal(finished.finalOutcome, "smoke_failed_after_publish");
      const failedRecord = await readRecord(harness.controlPlane.url, finished.deployRunId);
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
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${failedRecord.deployRunId} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(retry.stdout));
      assert.equal(summary.operationKind, "retry");
      const record = await readRecord(harness.controlPlane.url, summary.deployRunId);
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
      await harness.close();
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
    const statePath = path.join(tmp, "platform-state.json");
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
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const server = await startStaticWebappHttpsMultiServer({
      hosts: {
        [`${deployment.components[0]!.runtime.appName}.apps.kilty.io`]: () =>
          liveRootPath(hostRoot, deployment.components[0]!.runtime.appName),
        [`${deployment.components[1]!.runtime.appName}.apps.kilty.io`]: () =>
          liveRootPath(hostRoot, deployment.components[1]!.runtime.appName),
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
      const first = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --component-artifacts ${componentArtifactFlag({ frontend: frontendV1, api: apiV1 })} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(first.stdout));
      await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --component-artifacts ${componentArtifactFlag({ frontend: frontendV2, api: apiV2 })} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      await fsp.rm(path.join(tmp, "artifacts"), { recursive: true, force: true });
      const rollback = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${firstSummary.deployRunId} --rollback --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
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
      await harness.close();
      await server.close();
    }
  });
});
