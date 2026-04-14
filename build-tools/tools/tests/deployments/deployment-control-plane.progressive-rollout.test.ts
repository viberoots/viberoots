#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readDeploymentControlPlaneStatus } from "../../deployments/deployment-control-plane-read.ts";
import { submitDeploymentControlPlaneRunAction } from "../../deployments/deployment-control-plane-run-action.ts";
import { statusFromSubmission } from "../../deployments/deployment-control-plane-status.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { readControlPlaneJson } from "../../deployments/nixos-shared-host-control-plane-store.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import {
  pauseOnFinalSmoke,
  progressiveFixture,
  progressiveHosts,
} from "./deployment-control-plane.progressive-rollout.helpers.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import {
  expectPausedSubmission,
  writeDemoArtifact,
} from "./nixos-shared-host.control-plane.helpers.ts";
import { startStaticWebappHttpsMultiServer } from "./static-webapp.https-server.ts";

test("progressive rollout can pause and resume on the same deploy_run_id", async () => {
  await runInTemp("deployment-control-plane-progressive-resume", async (tmp, $) => {
    const deployment = progressiveFixture();
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeDemoArtifact(frontendArtifact, "frontend");
    await writeDemoArtifact(apiArtifact, "api");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-progressive-1",
      artifactIdentity: "artifact-progressive-1",
      artifactLineageId: "artifact-progressive-1",
    });
    const server = await startStaticWebappHttpsMultiServer({
      hosts: progressiveHosts(hostRoot),
      tlsRoot: hostRoot,
    });
    try {
      const paused = await expectPausedSubmission(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "deploy",
          deployment,
          artifactDirsByComponentId: { frontend: frontendArtifact, api: apiArtifact },
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot,
            recordsRoot,
          },
          admissionEvidence,
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
          ...pauseOnFinalSmoke(),
        }),
        (error) => {
          assert.equal(error.submission.lifecycleState, "paused");
          assert.equal(error.submission.progressiveRollout.state, "paused");
          assert.ok(error.submission.deployRunId);
        },
      );
      const resumed = await submitDeploymentControlPlaneRunAction({
        recordsRoot,
        submissionPath: paused.submissionPath,
        action: "resume",
        idempotencyKey: "resume-progressive-1",
      });
      assert.equal(resumed.latestAction?.action, "resume");
      assert.equal(resumed.lifecycleState, "finished");
      assert.equal(resumed.finalOutcome, "succeeded");
      assert.equal(resumed.deployRunId, paused.submission.deployRunId);
      assert.equal(resumed.progressiveRollout?.state, "succeeded");
    } finally {
      await server.close();
    }
  });
});

test("abort finishes a paused progressive rollout with an aborted record", async () => {
  await runInTemp("deployment-control-plane-progressive-abort", async (tmp, $) => {
    const deployment = progressiveFixture();
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeDemoArtifact(frontendArtifact, "frontend");
    await writeDemoArtifact(apiArtifact, "api");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-progressive-2",
      artifactIdentity: "artifact-progressive-2",
      artifactLineageId: "artifact-progressive-2",
    });
    const server = await startStaticWebappHttpsMultiServer({
      hosts: progressiveHosts(hostRoot),
      tlsRoot: hostRoot,
    });
    try {
      const paused = await expectPausedSubmission(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "deploy",
          deployment,
          artifactDirsByComponentId: { frontend: frontendArtifact, api: apiArtifact },
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot,
            recordsRoot,
          },
          admissionEvidence,
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
          ...pauseOnFinalSmoke(),
        }),
      );
      const aborted = await submitDeploymentControlPlaneRunAction({
        recordsRoot,
        submissionPath: paused.submissionPath,
        action: "abort",
        idempotencyKey: "abort-progressive-1",
      });
      assert.equal(aborted.finalOutcome, "aborted");
      assert.equal(aborted.progressiveRollout?.state, "aborted");
      assert.ok(aborted.deployRunId);
      const record = JSON.parse(
        await fsp.readFile(path.join(recordsRoot, "runs", `${aborted.deployRunId}.json`), "utf8"),
      );
      assert.equal(record.finalOutcome, "aborted");
      assert.equal(record.progressiveRollout.state, "aborted");
    } finally {
      await server.close();
    }
  });
});

test("newer runs are rejected while a progressive rollout is paused", async () => {
  await runInTemp("deployment-control-plane-progressive-supersedence", async (tmp, $) => {
    const deployment = progressiveFixture();
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeDemoArtifact(frontendArtifact, "frontend");
    await writeDemoArtifact(apiArtifact, "api");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-progressive-3",
      artifactIdentity: "artifact-progressive-3",
      artifactLineageId: "artifact-progressive-3",
    });
    const server = await startStaticWebappHttpsMultiServer({
      hosts: progressiveHosts(hostRoot),
      tlsRoot: hostRoot,
    });
    try {
      await assert.rejects(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "deploy",
          deployment,
          artifactDirsByComponentId: { frontend: frontendArtifact, api: apiArtifact },
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot,
            recordsRoot,
          },
          admissionEvidence,
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
          hooks: {
            gateEvaluator: ({ phaseId, outcome, defaultDecision }) =>
              phaseId === "smoke:final" && outcome === "succeeded" ? "pause" : defaultDecision,
          },
        }),
        () => true,
      );
      await assert.rejects(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "deploy",
          deployment,
          artifactDirsByComponentId: { frontend: frontendArtifact, api: apiArtifact },
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot,
            recordsRoot,
          },
          admissionEvidence,
        }),
        (error: any) => {
          assert.equal(error.submission.rejectionCode, "supersedence_blocked");
          return true;
        },
      );
      const submissionPath = path.join(
        recordsRoot,
        "control-plane",
        "submissions",
        (await fsp.readdir(path.join(recordsRoot, "control-plane", "submissions"))).sort()[0]!,
      );
      await assert.rejects(
        readDeploymentControlPlaneStatus({
          recordsRoot,
          submissionPath,
        }),
        /no longer accepts --submission-path/,
      );
      const status = statusFromSubmission(await readControlPlaneJson<any>(submissionPath));
      assert.equal(status.progressiveRollout?.state, "paused");
    } finally {
      await server.close();
    }
  });
});
