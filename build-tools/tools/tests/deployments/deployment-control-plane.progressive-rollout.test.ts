#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readDeploymentControlPlaneStatus } from "../../deployments/deployment-control-plane-read.ts";
import { submitDeploymentControlPlaneRunAction } from "../../deployments/deployment-control-plane-run-action.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startStaticWebappHttpsMultiServer } from "./static-webapp.https-server.ts";

async function writeArtifact(root: string, name: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${name}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

function progressiveFixture() {
  return nixosSharedHostDeploymentFixture({
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
}

test("progressive rollout can pause and resume on the same deploy_run_id", async () => {
  await runInTemp("deployment-control-plane-progressive-resume", async (tmp, $) => {
    const deployment = progressiveFixture();
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const frontendArtifact = path.join(tmp, "artifacts", "frontend");
    const apiArtifact = path.join(tmp, "artifacts", "api");
    await writeArtifact(frontendArtifact, "frontend");
    await writeArtifact(apiArtifact, "api");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-progressive-1",
      artifactIdentity: "artifact-progressive-1",
      artifactLineageId: "artifact-progressive-1",
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
      let paused: any;
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
        (error: any) => {
          paused = error;
          assert.equal(error.submission.lifecycleState, "paused");
          assert.equal(error.submission.progressiveRollout.state, "paused");
          assert.ok(error.submission.deployRunId);
          return true;
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
    await writeArtifact(frontendArtifact, "frontend");
    await writeArtifact(apiArtifact, "api");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-progressive-2",
      artifactIdentity: "artifact-progressive-2",
      artifactLineageId: "artifact-progressive-2",
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
      let paused: any;
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
        (error: any) => ((paused = error), true),
      );
      const aborted = await submitDeploymentControlPlaneRunAction({
        recordsRoot,
        submissionPath: paused.submissionPath,
        action: "abort",
        idempotencyKey: "abort-progressive-1",
      });
      assert.equal(aborted.finalOutcome, "aborted");
      assert.equal(aborted.progressiveRollout?.state, "aborted");
      const record = JSON.parse(await fsp.readFile(aborted.resultRecordPath!, "utf8"));
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
    await writeArtifact(frontendArtifact, "frontend");
    await writeArtifact(apiArtifact, "api");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-progressive-3",
      artifactIdentity: "artifact-progressive-3",
      artifactLineageId: "artifact-progressive-3",
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
      const status = await readDeploymentControlPlaneStatus({
        recordsRoot,
        deployRunId: (
          await readDeploymentControlPlaneStatus({
            recordsRoot,
            submissionPath: path.join(
              recordsRoot,
              "control-plane",
              "submissions",
              (
                await fsp.readdir(path.join(recordsRoot, "control-plane", "submissions"))
              ).sort()[0]!,
            ),
          })
        ).deployRunId,
      });
      assert.equal(status.progressiveRollout?.state, "paused");
    } finally {
      await server.close();
    }
  });
});
