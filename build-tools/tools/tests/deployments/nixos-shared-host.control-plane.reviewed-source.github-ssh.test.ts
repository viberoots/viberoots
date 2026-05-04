#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { cleanupReviewedSourceSnapshot } from "../../deployments/nixos-shared-host-reviewed-source-snapshot";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { runInTemp } from "../lib/test-helpers";

async function gitStdout(cwd: string, $: any, ...args: string[]): Promise<string> {
  return String((await $({ cwd, stdio: "pipe" })`git ${args}`).stdout).trim();
}

test("github reviewed-source snapshots fetch the declared repository over SSH", async () => {
  await runInTemp("nixos-reviewed-source-github-ssh", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const expectedRevision = await gitStdout(tmp, $, "rev-parse", "env/pleomino/dev");
    await $({ cwd: tmp, stdio: "pipe" })`git remote set-url origin ${path.join(tmp, "wrong.git")}`;
    const prepared = await prepareBackendNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: "deploy",
      deployment,
      paths: {
        statePath: path.join(tmp, "platform-state.json"),
        hostRoot: path.join(tmp, "host"),
        recordsRoot,
      },
      backend: {
        recordsRoot,
        databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
      },
      artifactDir,
      admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      dedupe: { mode: "created", requestFingerprint: "sha256:reviewed-source-github-ssh" },
      expectedSourceRevision: expectedRevision,
    });
    try {
      const reviewed = prepared.snapshot.admittedContext?.targetEnvironment.reviewedSourceSnapshot;
      assert.equal(reviewed?.sourceRevision, expectedRevision);
      assert.equal(reviewed?.repository, deployment.lanePolicy.governance.repository);
      assert.equal(
        await gitStdout(tmp, $, "rev-parse", reviewed?.snapshotRef || ""),
        expectedRevision,
      );
    } finally {
      await cleanupReviewedSourceSnapshot(tmp, prepared.snapshot);
    }
  });
});
