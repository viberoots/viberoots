#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { acquireControlPlaneLock } from "../../deployments/nixos-shared-host-control-plane-store";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { runInTemp } from "../lib/test-helpers";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import {
  waitFor,
  withEnvOverrides,
  writeDemoArtifact,
} from "./nixos-shared-host.control-plane.helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

async function submissionPaths(recordsRoot: string): Promise<string[]> {
  const dir = path.join(recordsRoot, "control-plane", "submissions");
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  return entries.filter((entry) => entry.endsWith(".json")).map((entry) => path.join(dir, entry));
}

async function waitForSubmission(recordsRoot: string): Promise<string> {
  return await waitFor(
    async () => (await submissionPaths(recordsRoot))[0] || null,
    "missing submission",
  );
}

async function waitForSubmissionCount(recordsRoot: string, count: number): Promise<string[]> {
  return await waitFor(async () => {
    const paths = await submissionPaths(recordsRoot);
    return paths.length >= count ? paths : null;
  }, `expected ${count} submissions`);
}

async function waitForLifecycle(submissionPath: string, lifecycleState: string): Promise<void> {
  await waitFor(async () => {
    const submission = JSON.parse(await fsp.readFile(submissionPath, "utf8"));
    return submission.lifecycleState === lifecycleState ? submission : null;
  }, `submission never reached ${lifecycleState}`);
}

const INTEGRATION_LOCK_WAIT_TIMEOUT_MS = "10000";

test(
  "shared control plane times out queued runs after the default lock wait budget",
  { concurrency: false },
  async () => {
    await withEnvOverrides(
      {
        VBR_DEPLOY_LOCK_WAIT_TIMEOUT_MS: "200",
        VBR_DEPLOY_LOCK_POLL_MS: "25",
      },
      async () => {
        await runInTemp("deployment-control-plane-lock-timeout", async (tmp) => {
          const deployment = nixosSharedHostDeploymentFixture();
          const recordsRoot = path.join(tmp, "records");
          const lock = await acquireControlPlaneLock(
            recordsRoot,
            deployment.providerTarget.deploymentTargetIdentity,
          );
          try {
            await assert.rejects(
              submitNixosSharedHostControlPlaneRun({
                workspaceRoot: tmp,
                operationKind: "explicit_removal",
                deployment,
                paths: {
                  statePath: path.join(tmp, "platform-state.json"),
                  hostRoot: path.join(tmp, "host"),
                  recordsRoot,
                },
              }),
              (error: any) => {
                assert.equal(error.submission.terminationReason, "lock_timeout");
                assert.equal(error.submission.lifecycleState, "finished");
                return true;
              },
            );
          } finally {
            await lock.release();
          }
        });
      },
    );
  },
);

test(
  "later queued normal deploy supersedes older queued normal deploy for the same deployment and lock scope",
  { concurrency: false },
  async () => {
    await withEnvOverrides(
      {
        VBR_DEPLOY_LOCK_WAIT_TIMEOUT_MS: INTEGRATION_LOCK_WAIT_TIMEOUT_MS,
        VBR_DEPLOY_LOCK_POLL_MS: "25",
      },
      async () => {
        await runInTemp("deployment-control-plane-supersedence", async (tmp, $) => {
          const deployment = nixosSharedHostDeploymentFixture({
            runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
          });
          const artifactDir = path.join(tmp, "artifact");
          const hostRoot = path.join(tmp, "host");
          const recordsRoot = path.join(tmp, "records");
          await writeDemoArtifact(artifactDir);
          await ensureNixosSharedHostStageBranch(tmp, $, deployment);
          const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
          const blocker = await acquireControlPlaneLock(
            recordsRoot,
            deployment.providerTarget.deploymentTargetIdentity,
          );
          try {
            const firstRun = submitNixosSharedHostControlPlaneRun({
              workspaceRoot: tmp,
              operationKind: "deploy",
              deployment,
              artifactDir,
              paths: {
                statePath: path.join(tmp, "platform-state.json"),
                hostRoot,
                recordsRoot,
              },
              admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
              smokeConnectOverride: {
                protocol: "https:",
                hostname: "127.0.0.1",
                port: server.port,
                rejectUnauthorized: false,
              },
            });
            const firstRunError = firstRun.then(
              () => null,
              (error) => error,
            );
            const firstSubmissionPath = await waitForSubmission(recordsRoot);
            await waitForLifecycle(firstSubmissionPath, "waiting_for_lock");
            const secondRun = submitNixosSharedHostControlPlaneRun({
              workspaceRoot: tmp,
              operationKind: "deploy",
              deployment: nixosSharedHostDeploymentFixture({
                runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
              }),
              artifactDir,
              paths: {
                statePath: path.join(tmp, "platform-state.json"),
                hostRoot,
                recordsRoot,
              },
              admissionEvidence: reviewedLaneAdmissionEvidenceFixture({
                deployment: nixosSharedHostDeploymentFixture({
                  runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
                }),
              }),
              smokeConnectOverride: {
                protocol: "https:",
                hostname: "127.0.0.1",
                port: server.port,
                rejectUnauthorized: false,
              },
            });
            await waitForSubmissionCount(recordsRoot, 2);
            await blocker.release();
            const secondResult = await secondRun;
            assert.equal(secondResult.submission.terminationReason, null);
            const firstError = await firstRunError;
            assert.ok(firstError);
            assert.equal(firstError.submission.terminationReason, "superseded");
            assert.equal(firstError.submission.lifecycleState, "finished");
          } finally {
            await blocker.release().catch(() => {});
            await server.close();
          }
        });
      },
    );
  },
);

test(
  "queued shared deploy revalidates branch state after lock acquisition and exits without mutation when stale",
  { concurrency: false },
  async () => {
    await withEnvOverrides(
      {
        VBR_DEPLOY_LOCK_WAIT_TIMEOUT_MS: INTEGRATION_LOCK_WAIT_TIMEOUT_MS,
        VBR_DEPLOY_LOCK_POLL_MS: "25",
      },
      async () => {
        await runInTemp("deployment-control-plane-revalidation", async (tmp, $) => {
          const deployment = nixosSharedHostDeploymentFixture();
          const artifactDir = path.join(tmp, "artifact");
          const recordsRoot = path.join(tmp, "records");
          await writeDemoArtifact(artifactDir);
          await ensureNixosSharedHostStageBranch(tmp, $, deployment);
          const blocker = await acquireControlPlaneLock(
            recordsRoot,
            deployment.providerTarget.deploymentTargetIdentity,
          );
          try {
            const run = submitNixosSharedHostControlPlaneRun({
              workspaceRoot: tmp,
              operationKind: "deploy",
              deployment,
              artifactDir,
              paths: {
                statePath: path.join(tmp, "platform-state.json"),
                hostRoot: path.join(tmp, "host"),
                recordsRoot,
              },
              admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
            });
            const submissionPath = await waitForSubmission(recordsRoot);
            await waitForLifecycle(submissionPath, "waiting_for_lock");
            await $({
              cwd: tmp,
              stdio: "pipe",
            })`git -c user.name=Test -c user.email=test@example.com commit --allow-empty -m queued-drift`;
            await ensureNixosSharedHostStageBranch(tmp, $, deployment);
            await blocker.release();
            await assert.rejects(run, (error: any) => {
              assert.equal(error.submission.terminationReason, "no_longer_admitted");
              assert.equal(error.submission.lifecycleState, "finished");
              return true;
            });
          } finally {
            await blocker.release().catch(() => {});
          }
        });
      },
    );
  },
);
