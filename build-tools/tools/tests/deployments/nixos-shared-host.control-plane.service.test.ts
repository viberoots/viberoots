#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA } from "../../deployments/deployment-control-plane-contract.ts";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop.ts";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract.ts";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture.ts";
import {
  reviewedLaneAdmissionEvidenceFixture,
  writeReviewedLaneAdmissionEvidenceJson,
} from "./deployment-lane-governance.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import {
  smokeConnectOverride,
  waitFor,
  writeDemoArtifact,
} from "./nixos-shared-host.control-plane.helpers.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  assert.equal(response.ok, true, body);
  return JSON.parse(body) as T;
}

async function submitServiceRequest(opts: {
  url: string;
  deployment: any;
  artifactDir: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
}) {
  return await readJson<any>(
    await fetch(new URL("/api/v1/submissions", opts.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: createNixosSharedHostSubmissionId(),
        submittedAt: new Date().toISOString(),
        deployment: opts.deployment,
        operationKind: "deploy",
        artifactDir: opts.artifactDir,
        ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
        ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      }),
    }),
  );
}

async function readStatus(url: string, submissionId: string) {
  const requestUrl = new URL("/api/v1/status", url);
  requestUrl.searchParams.set("submissionId", submissionId);
  return await readJson<any>(await fetch(requestUrl));
}

test("control-plane service persists queued submissions across restart and a separate worker later executes them", async () => {
  await runInTemp("nixos-shared-host-control-plane-service-queue", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl,
    });
    try {
      const submitted = await submitServiceRequest({
        url: controlPlane.url,
        deployment,
        artifactDir,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: smokeConnectOverride(server.port),
      });
      assert.equal(submitted.lifecycleState, "waiting_for_lock");
      const beforeRestart = await readStatus(controlPlane.url, submitted.submissionId);
      assert.equal(beforeRestart.lifecycleState, "waiting_for_lock");
      await controlPlane.close();
      const restarted = await startNixosSharedHostControlPlaneServer({
        workspaceRoot: tmp,
        paths,
        backendDatabaseUrl,
      });
      try {
        const afterRestart = await readStatus(restarted.url, submitted.submissionId);
        assert.equal(afterRestart.lifecycleState, "waiting_for_lock");
        const worker = startNixosSharedHostControlPlaneWorkerLoop({
          workspaceRoot: tmp,
          recordsRoot: paths.recordsRoot,
          backendDatabaseUrl,
        });
        try {
          const finished = await waitFor(async () => {
            const status = await readStatus(restarted.url, submitted.submissionId);
            return status.lifecycleState === "finished" ? status : null;
          }, "timed out waiting for service worker completion");
          assert.equal(finished.finalOutcome, "succeeded");
          assert.ok(finished.resultRecordPath);
        } finally {
          await worker.close();
        }
      } finally {
        await restarted.close();
      }
    } finally {
      await server.close();
    }
  });
});

test("control-plane run-action API cancels a queued submission and keeps the status durable", async () => {
  await runInTemp("nixos-shared-host-control-plane-service-cancel", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl,
    });
    try {
      const submitted = await submitServiceRequest({
        url: controlPlane.url,
        deployment,
        artifactDir,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      });
      const cancelled = await readJson<any>(
        await fetch(new URL("/api/v1/run-actions", controlPlane.url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
            actionId: "cancel-queued-1",
            submittedAt: new Date().toISOString(),
            submissionId: submitted.submissionId,
            action: "cancel",
            idempotencyKey: "cancel-queued-1",
          }),
        }),
      );
      assert.equal(cancelled.lifecycleState, "cancelled");
      await controlPlane.close();
      const restarted = await startNixosSharedHostControlPlaneServer({
        workspaceRoot: tmp,
        paths,
        backendDatabaseUrl,
      });
      try {
        const status = await readStatus(restarted.url, submitted.submissionId);
        assert.equal(status.lifecycleState, "cancelled");
        assert.equal(status.terminationReason, "cancelled");
      } finally {
        await restarted.close();
      }
    } finally {
      if ((controlPlane as any).close) {
        await controlPlane.close().catch(() => {});
      }
    }
  });
});

test("repo-level deploy submits shared-host mutation through the configured control-plane service", async () => {
  await runInTemp("nixos-shared-host-control-plane-service-cli", async (tmp, $) => {
    const deploymentLabel = "//sandbox/deployments/demo-dev:deploy";
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot,
      recordsRoot: path.join(tmp, "records"),
    };
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
    await writeTempListedDeploymentWorkspace(tmp);
    await writeDemoArtifact(artifactDir);
    const deployment = await resolveDeploymentFromTarget(tmp, deploymentLabel);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deployment,
      deploymentLabel,
      includeRequiredChecks: true,
    });
    const server = await startNixosSharedHostPublicServer({
      deployment: deployment as any,
      hostRoot,
    });
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl,
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: paths.recordsRoot,
      backendDatabaseUrl,
    });
    try {
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deploymentLabel} --artifact-dir ${artifactDir} --admission-evidence-json ${admissionEvidenceJson} --control-plane-url ${controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      const submissionId = summary.controlPlane?.submissionId || summary.submissionId;
      assert.equal(typeof submissionId, "string");
      const status = await readStatus(controlPlane.url, submissionId);
      assert.equal(status.lifecycleState, "finished");
      assert.equal(status.finalOutcome, "succeeded");
      assert.equal(summary.finalOutcome || status.finalOutcome, "succeeded");
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
    }
  });
});
