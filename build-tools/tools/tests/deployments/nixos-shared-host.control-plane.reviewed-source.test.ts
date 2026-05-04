#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { executeSubmittedNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-submit-helpers";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { materializeBackendControlPlaneFiles } from "../../deployments/nixos-shared-host-control-plane-backend-materialize";
import { runNixosSharedHostDirectServiceMutation } from "../../deployments/nixos-shared-host-control-plane-service-front-door";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { cleanupReviewedSourceSnapshot } from "../../deployments/nixos-shared-host-reviewed-source-snapshot";
import { smokeConnectOverride, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import { runInTemp } from "../lib/test-helpers";

async function gitStdout(cwd: string, $: any, ...args: string[]): Promise<string> {
  return String((await $({ cwd, stdio: "pipe" })`git ${args}`).stdout).trim();
}

async function commitLocalChange(cwd: string, $: any, name: string): Promise<string> {
  await fsp.writeFile(path.join(cwd, `${name}.txt`), `${name}\n`, "utf8");
  await $({ cwd, stdio: "pipe" })`git add ${`${name}.txt`}`;
  await $({ cwd, stdio: "pipe" })`git commit -m ${name}`;
  return await gitStdout(cwd, $, "rev-parse", "HEAD");
}

function submissionPaths(tmp: string) {
  return {
    statePath: path.join(tmp, "platform-state.json"),
    hostRoot: path.join(tmp, "host"),
    recordsRoot: path.join(tmp, "records"),
  };
}

test("backend snapshots the reviewed ref from the remote instead of ambient local branch state", async () => {
  await runInTemp("nixos-reviewed-source-snapshot", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`git remote set-url origin git@github.com:kiltyj/bucknix-fresh.git`;
    const remoteRevision = await gitStdout(tmp, $, "rev-parse", "env/pleomino/dev");
    await commitLocalChange(tmp, $, "local-drift");
    await $({ cwd: tmp, stdio: "pipe" })`git branch -f env/pleomino/dev HEAD`;
    const ambientRevision = await gitStdout(tmp, $, "rev-parse", "env/pleomino/dev");
    assert.notEqual(ambientRevision, remoteRevision);
    const fetchHeadPath = path.join(tmp, ".git", "FETCH_HEAD");
    await fsp.writeFile(fetchHeadPath, "read-only fetch head\n", "utf8");
    await fsp.chmod(fetchHeadPath, 0o400);
    const prepared = await prepareBackendNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: "deploy",
      deployment,
      paths: submissionPaths(tmp),
      backend: {
        recordsRoot: path.join(tmp, "records"),
        databaseUrl: localHarnessControlPlaneDatabaseUrl(path.join(tmp, "records")),
      },
      artifactDir,
      admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      dedupe: { mode: "created", requestFingerprint: "sha256:reviewed-source-1" },
      expectedSourceRevision: remoteRevision,
    });
    try {
      const reviewed = prepared.snapshot.admittedContext?.targetEnvironment.reviewedSourceSnapshot;
      assert.equal(prepared.snapshot.admittedContext?.source.sourceRevision, remoteRevision);
      assert.equal(reviewed?.sourceRevision, remoteRevision);
      assert.ok(reviewed?.snapshotRef);
      assert.notEqual(reviewed?.snapshotRef, "env/pleomino/dev");
      assert.equal(await fsp.readFile(fetchHeadPath, "utf8"), "read-only fetch head\n");
      assert.equal(
        await gitStdout(tmp, $, "rev-parse", reviewed?.snapshotRef || ""),
        remoteRevision,
      );
    } finally {
      await fsp.chmod(fetchHeadPath, 0o600).catch(() => undefined);
      await cleanupReviewedSourceSnapshot(tmp, prepared.snapshot);
    }
  });
});

test("service-backed deploy fails closed when the client and service disagree on the reviewed commit", async () => {
  await runInTemp("nixos-reviewed-source-mismatch", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const paths = submissionPaths(tmp);
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const serviceRevision = await gitStdout(tmp, $, "rev-parse", "env/pleomino/dev");
    await commitLocalChange(tmp, $, "client-drift");
    await $({ cwd: tmp, stdio: "pipe" })`git branch -f env/pleomino/dev HEAD`;
    const clientRevision = await gitStdout(tmp, $, "rev-parse", "env/pleomino/dev");
    assert.notEqual(clientRevision, serviceRevision);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      localFixture: true,
    });
    try {
      await assert.rejects(
        runNixosSharedHostDirectServiceMutation({
          workspaceRoot: tmp,
          controlPlaneUrl: controlPlane.url,
          deployment,
          operationKind: "deploy",
          artifactDir,
        }),
        new RegExp(
          [
            "reviewed source mismatch for env/pleomino/dev",
            `clientExpectedSourceRevision=${clientRevision}`,
            `serviceReviewedSourceRevision=${serviceRevision}`,
            "service fetched the reviewed deployment branch before admission",
            "that branch is up to date and pushed before retrying",
          ].join("[\\s\\S]*"),
        ),
      );
    } finally {
      await controlPlane.close();
    }
  });
});

test("same-ref submissions snapshot different reviewed commits without clobbering each other", async () => {
  await runInTemp("nixos-reviewed-source-concurrency", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = submissionPaths(tmp);
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const firstRevision = await gitStdout(tmp, $, "rev-parse", "env/pleomino/dev");
    const first = await prepareBackendNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: "deploy",
      deployment,
      paths,
      backend: {
        recordsRoot: paths.recordsRoot,
        databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      },
      artifactDir,
      admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      dedupe: { mode: "created", requestFingerprint: "sha256:reviewed-source-a" },
      expectedSourceRevision: firstRevision,
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      await commitLocalChange(tmp, $, "remote-advance");
      await ensureNixosSharedHostStageBranch(tmp, $, deployment);
      const secondRevision = await gitStdout(tmp, $, "rev-parse", "env/pleomino/dev");
      const second = await prepareBackendNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        paths,
        backend: {
          recordsRoot: paths.recordsRoot,
          databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
        },
        artifactDir,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: smokeConnectOverride(server.port),
        dedupe: { mode: "created", requestFingerprint: "sha256:reviewed-source-b" },
        expectedSourceRevision: secondRevision,
      });
      try {
        const firstRef =
          first.snapshot.admittedContext?.targetEnvironment.reviewedSourceSnapshot?.snapshotRef ||
          "";
        const secondRef =
          second.snapshot.admittedContext?.targetEnvironment.reviewedSourceSnapshot?.snapshotRef ||
          "";
        assert.notEqual(firstRef, secondRef);
        assert.equal(await gitStdout(tmp, $, "rev-parse", firstRef), firstRevision);
        assert.equal(await gitStdout(tmp, $, "rev-parse", secondRef), secondRevision);
        const materialized = await materializeBackendControlPlaneFiles(
          {
            recordsRoot: paths.recordsRoot,
            databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
          },
          second.submission.submissionId,
        );
        try {
          const executed = await executeSubmittedNixosSharedHostControlPlaneRun({
            submission: second.submission,
            submissionPath: materialized.submissionPath,
            executionSnapshotPath: materialized.executionSnapshotPath,
            snapshot: second.snapshot,
            workspaceRoot: tmp,
            deployRunId: second.deployRunId,
            recordsRoot: paths.recordsRoot,
            operationKind: second.snapshot.operationKind,
            deployment: second.snapshot.deployment,
            gateEvaluator: undefined,
            onLockAcquired: undefined,
            acquireLocks: async () => ({ release: async () => {} }),
          });
          assert.equal(executed.submission.lifecycleState, "finished");
          assert.notEqual(
            (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse ${secondRef}`.nothrow()).exitCode,
            0,
          );
        } finally {
          await materialized.cleanup();
        }
      } finally {
        await cleanupReviewedSourceSnapshot(tmp, first.snapshot);
      }
    } finally {
      await server.close();
    }
  });
});
