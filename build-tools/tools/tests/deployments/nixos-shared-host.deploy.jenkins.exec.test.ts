#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop.ts";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { installFakeRemoteTransport } from "./nixos-shared-host.remote-transport.fake.ts";
import {
  installClientProfile,
  installReviewedPleominoTargets,
  jenkinsExecEnv,
  pleominoDeploymentFixture,
  prepareReviewedRemoteHostPaths,
  writeArtifact,
  writeReviewedPleominoAdmissionEvidence,
  writeJenkinsAuthFiles,
} from "./nixos-shared-host.jenkins.fixture.ts";
import { readBackendSnapshot } from "./nixos-shared-host.control-plane.helpers.ts";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";

test("jenkins wrapper stages the Pleomino artifact, submits through the control plane, and emits stable JSON", async () => {
  await runInTemp("nixos-shared-host-jenkins-exec", async (tmp, $) => {
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    await installReviewedPleominoTargets(tmp);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: remoteStatePath,
        hostRoot: remoteRuntimeRoot,
        recordsRoot: remoteRecordsRoot,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      token: CONTROL_PLANE_TOKEN,
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: remoteRecordsRoot,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
    });
    await writeArtifact(artifactDir, { "index.html": "<html>jenkins</html>\n", healthz: "ok\n" });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
      controlPlane.url,
    );
    const { admissionEvidencePath } = await writeReviewedPleominoAdmissionEvidence(tmp, $);
    const auth = await writeJenkinsAuthFiles(tmp);
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: jenkinsExecEnv(env),
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.ok, true);
      assert.equal(summary.schemaVersion, "nixos-shared-host-jenkins-deploy@1");
      assert.equal(summary.remotePlan.destination, "mini");
      assert.equal(summary.jenkinsContract.transport.identityFile, auth.identityFile);
      assert.equal(summary.jenkinsContract.transport.knownHostsFile, auth.knownHostsFile);
      assert.equal(summary.remoteExecution.controlPlane.finalOutcome, "succeeded");
      const record = summary.remoteExecution.controlPlane.record;
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:pleomino");
      const snapshot = await readBackendSnapshot(
        remoteRecordsRoot,
        String(record.controlPlane.submissionId),
      );
      assert.equal(snapshot.deploymentLabel, "//projects/deployments/pleomino-dev:deploy");
      assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:pleomino");
      const liveIndex = path.join(
        nixosSharedHostContainerRoot(remoteRuntimeRoot, deployment.providerTarget.containerName),
        "srv/static-app/live/index.html",
      );
      assert.equal(await fsp.readFile(liveIndex, "utf8"), "<html>jenkins</html>\n");
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
    }
  });
});

test("jenkins wrapper forwards mark-check-passed so bootstrap deploys can avoid hand-written evidence", async () => {
  await runInTemp("nixos-shared-host-jenkins-exec-mark-check-passed", async (tmp, $) => {
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    await installReviewedPleominoTargets(tmp);
    const sharedTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino-shared",
      "TARGETS",
    );
    await fsp.writeFile(
      sharedTargetsPath,
      (await fsp.readFile(sharedTargetsPath, "utf8"))
        .replace('"required_checks": "",', '"required_checks": "deploy/pleomino-dev",')
        .replace("    required_checks = [],", '    required_checks = ["deploy/pleomino-dev"],'),
      "utf8",
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: remoteStatePath,
        hostRoot: remoteRuntimeRoot,
        recordsRoot: remoteRecordsRoot,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      token: CONTROL_PLANE_TOKEN,
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: remoteRecordsRoot,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
    });
    await writeArtifact(artifactDir, { "index.html": "<html>bootstrap</html>\n", healthz: "ok\n" });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
      controlPlane.url,
    );
    const { admissionEvidencePath } = await writeReviewedPleominoAdmissionEvidence(tmp, $);
    const auth = await writeJenkinsAuthFiles(tmp);
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: jenkinsExecEnv(env),
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --admission-evidence-json ${admissionEvidencePath} --mark-check-passed deploy/pleomino-dev --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.ok, true);
      assert.equal(summary.remoteExecution.controlPlane.finalOutcome, "succeeded");
      const snapshot = await readBackendSnapshot(
        remoteRecordsRoot,
        String(summary.remoteExecution.controlPlane.submissionId),
      );
      assert.equal(
        snapshot.admittedContext.policyEvaluation.requiredChecks[0]?.reportingKind,
        "ci_pipeline",
      );
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
    }
  });
});
