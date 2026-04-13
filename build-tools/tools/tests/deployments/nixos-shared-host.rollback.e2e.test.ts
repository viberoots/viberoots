#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import {
  liveIndexPath,
  writeAdmissionEvidenceJson,
  writeArtifact,
  writeDeploymentJson,
} from "./nixos-shared-host.reuse.e2e.helpers.ts";

test("nixos-shared-host rollback restores a prior known-good exact artifact", async () => {
  await runInTemp("nixos-shared-host-rollback-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactV1 = path.join(tmp, "artifact-v1");
    const artifactV2 = path.join(tmp, "artifact-v2");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const commandEnv = {
      ...process.env,
      BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    await writeArtifact(artifactV1, "v1");
    await writeArtifact(artifactV2, "v2");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
      deployment,
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const first = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactV1} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(first.stdout));
      await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactV2} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      assert.match(await fsp.readFile(liveIndexPath(hostRoot, "demoapp"), "utf8"), /v2/);
      await fsp.rm(artifactV1, { recursive: true, force: true });
      await fsp.rm(artifactV2, { recursive: true, force: true });
      const rollback = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${firstSummary.deployRunId} --rollback --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(rollback.stdout));
      assert.equal(summary.operationKind, "rollback");
      assert.equal(summary.runClassification, "rollback");
      assert.equal(summary.parentRunId, firstSummary.deployRunId);
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.parentRunId, firstSummary.deployRunId);
      assert.equal(record.artifact.identity, firstSummary.artifactIdentity);
      assert.equal(record.artifactLineageId, firstSummary.artifactIdentity);
      assert.match(await fsp.readFile(liveIndexPath(hostRoot, "demoapp"), "utf8"), /v1/);
    } finally {
      await server.close();
    }
  });
});
