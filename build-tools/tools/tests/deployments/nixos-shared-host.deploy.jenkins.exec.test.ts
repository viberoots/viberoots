#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { artifactIdentityForNixosSharedHostDir } from "../../deployments/nixos-shared-host-artifacts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime";
import { runInTemp } from "../lib/test-helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { installFakeRemoteTransport } from "./nixos-shared-host.remote-transport.fake";
import {
  installClientProfile,
  installReviewedPleominoTargets,
  jenkinsExecEnv,
  pleominoDeploymentFixture,
  prepareReviewedRemoteHostPaths,
  requireServiceAuthForPleomino,
  writeArtifact,
  writeReviewedPleominoAdmissionEvidence,
  writeJenkinsAuthFiles,
} from "./nixos-shared-host.jenkins.fixture";
import { readBackendSnapshot } from "./nixos-shared-host.control-plane.helpers";
import { viberootsToolScript } from "./deployment-command";
import { writeAuthSession } from "./nixos-shared-host.service-auth-boundary.helpers";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";

type RemoteControlPlaneRuntime = {
  tmp: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
};

async function startObjectBackedControlPlaneWorker(opts: RemoteControlPlaneRuntime) {
  const objectStore = memoryControlPlaneArtifactStore();
  const controlPlane = await startNixosSharedHostControlPlaneServer({
    workspaceRoot: opts.tmp,
    paths: {
      statePath: opts.remoteStatePath,
      hostRoot: opts.remoteRuntimeRoot,
      recordsRoot: opts.remoteRecordsRoot,
    },
    backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(opts.remoteRecordsRoot),
    token: CONTROL_PLANE_TOKEN,
    objectStore,
  });
  const worker = startNixosSharedHostControlPlaneWorkerLoop({
    workspaceRoot: opts.tmp,
    recordsRoot: opts.remoteRecordsRoot,
    backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(opts.remoteRecordsRoot),
    objectStore,
  });
  return { controlPlane, worker };
}

async function writeJenkinsSubmitterAuthSession(recordsRoot: string, deployment: any) {
  return await writeAuthSession({
    recordsRoot,
    deployment,
    operationKind: "deploy",
    principalId: "oidc:service-account-jenkins",
    roles: ["submitter", "admission_reporter"],
  });
}

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
    await requireServiceAuthForPleomino(tmp);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    const { controlPlane, worker } = await startObjectBackedControlPlaneWorker({
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
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
    const admissionEvidence = JSON.parse(await fsp.readFile(admissionEvidencePath, "utf8"));
    const sourceRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
    ).trim();
    admissionEvidence.ciSubmission = {
      system: "jenkins",
      sourceRevision,
      builderIdentity: "jenkins:mini/pleomino",
      artifactIdentity: await artifactIdentityForNixosSharedHostDir(artifactDir, "static-webapp"),
      artifactRef: "retained-artifact://jenkins/pleomino-dev/1",
      idempotencyKey: "jenkins-pleomino-dev-1",
      sbomRefs: ["oci://sbom/pleomino@sha256:beef"],
      signatureRefs: ["sigstore://pleomino/1"],
      provenanceRefs: ["slsa://jenkins/pleomino/1"],
    };
    await fsp.writeFile(admissionEvidencePath, JSON.stringify(admissionEvidence, null, 2), "utf8");
    const auth = await writeJenkinsAuthFiles(tmp);
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    const authSessionId = await writeJenkinsSubmitterAuthSession(remoteRecordsRoot, deployment);
    const jenkinsDeploy = viberootsToolScript(
      "viberoots/build-tools/tools/bin/nixos-shared-host-jenkins-deploy",
    );
    const jenkinsCommand = (sessionId: string) =>
      $({
        cwd: tmp,
        env: jenkinsExecEnv(env),
      })`${jenkinsDeploy} --deployment //projects/deployments/pleomino/dev:deploy --admission-evidence-json ${admissionEvidencePath} --idempotency-key jenkins-pleomino-dev-1 --auth-session-id ${sessionId} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
    try {
      const result = await jenkinsCommand(authSessionId);
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
      assert.equal(snapshot.deploymentId, "pleomino-dev");
      assert.equal(snapshot.executionSnapshotObject?.provenance?.payloadKind, "execution-snapshot");
      assert.equal(snapshot.artifactObjects?.length, 1);
      assert.equal(
        record.admittedContext.policyEvaluation.ciSubmission.idempotencyKey,
        "jenkins-pleomino-dev-1",
      );
      const retryAuthSessionId = await writeJenkinsSubmitterAuthSession(
        remoteRecordsRoot,
        deployment,
      );
      const retried = JSON.parse(String((await jenkinsCommand(retryAuthSessionId)).stdout));
      assert.equal(
        retried.remoteExecution.controlPlane.submissionId,
        record.controlPlane.submissionId,
      );
      await writeArtifact(artifactDir, { "index.html": "<html>changed</html>\n" });
      const conflictAuthSessionId = await writeJenkinsSubmitterAuthSession(
        remoteRecordsRoot,
        deployment,
      );
      const conflict = await jenkinsCommand(conflictAuthSessionId).nothrow();
      assert.notEqual(conflict.exitCode, 0);
      assert.match(String(conflict.stdout), /idempotency/i);
      const liveIndex = path.join(
        nixosSharedHostContainerRoot(remoteRuntimeRoot, deployment.providerTarget.containerName),
        "srv/static-app/live/index.html",
      );
      assert.equal(await fsp.readFile(liveIndex, "utf8"), "<html>jenkins</html>\n");
    } finally {
      await Promise.all([worker.close(), controlPlane.close(), server.close()]);
    }
  });
});

test("jenkins wrapper forwards admit-and-deploy so bootstrap deploys can avoid hand-written evidence", async () => {
  await runInTemp("nixos-shared-host-jenkins-exec-admit-and-deploy", async (tmp, $) => {
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    await installReviewedPleominoTargets(tmp);
    await requireServiceAuthForPleomino(tmp);
    const sharedTargetsPath = path.join(tmp, "projects/deployments/pleomino/shared/TARGETS");
    await fsp.writeFile(
      sharedTargetsPath,
      (await fsp.readFile(sharedTargetsPath, "utf8"))
        .replace('"required_checks": ""}', '"required_checks": "deploy/pleomino-dev"}')
        .replace("    required_checks = [],", '    required_checks = ["deploy/pleomino-dev"],'),
      "utf8",
    );
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    const { controlPlane, worker } = await startObjectBackedControlPlaneWorker({
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
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
    const jenkinsDeploy = viberootsToolScript(
      "viberoots/build-tools/tools/bin/nixos-shared-host-jenkins-deploy",
    );
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    const authSessionId = await writeJenkinsSubmitterAuthSession(remoteRecordsRoot, deployment);
    try {
      const result = await $({
        cwd: tmp,
        env: jenkinsExecEnv(env),
      })`${jenkinsDeploy} --deployment //projects/deployments/pleomino/dev:deploy --admission-evidence-json ${admissionEvidencePath} --admit-and-deploy deploy/pleomino-dev --auth-session-id ${authSessionId} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.ok, true);
      assert.equal(summary.remoteExecution.controlPlane.finalOutcome, "succeeded");
      assert.equal(
        summary.remoteExecution.controlPlane.record.admittedContext.policyEvaluation
          .requiredChecks[0]?.reportingKind,
        "ci_pipeline",
      );
    } finally {
      await Promise.all([worker.close(), controlPlane.close(), server.close()]);
    }
  });
});
