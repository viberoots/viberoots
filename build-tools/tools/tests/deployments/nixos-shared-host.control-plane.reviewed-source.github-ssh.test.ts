#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { cleanupReviewedSourceSnapshot } from "../../deployments/nixos-shared-host-reviewed-source-snapshot";
import { gitFetchEnvForReviewedRemote } from "../../deployments/nixos-shared-host-reviewed-source-git";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import {
  deploymentSourceRef,
  ensureNixosSharedHostReviewedSourceRef,
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
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const sourceRef = deploymentSourceRef(deployment);
    const expectedRevision = await gitStdout(tmp, $, "rev-parse", sourceRef);
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

test("github reviewed-source fetch env uses mounted credentials over ambient ssh env", async () => {
  await runInTemp("nixos-reviewed-source-mounted-ssh", async (tmp) => {
    const key = path.join(tmp, "reviewed-source-ssh-key");
    const knownHosts = path.join(tmp, "reviewed-source-known-hosts");
    const previous = process.env.GIT_SSH_COMMAND;
    process.env.GIT_SSH_COMMAND = "ssh -i /tmp/ambient-key";
    try {
      const result = await gitFetchEnvForReviewedRemote(tmp, "git@github.com:owner/repo.git", {
        sshKeyFile: key,
        sshKnownHostsFile: knownHosts,
      });
      assert.match(result.env?.GIT_SSH_COMMAND || "", new RegExp(`-i '${key}'`));
      assert.match(
        result.env?.GIT_SSH_COMMAND || "",
        new RegExp(`UserKnownHostsFile='${knownHosts}'`),
      );
      assert.doesNotMatch(result.env?.GIT_SSH_COMMAND || "", /ambient-key/);
      await result.cleanup();
    } finally {
      if (previous === undefined) delete process.env.GIT_SSH_COMMAND;
      else process.env.GIT_SSH_COMMAND = previous;
    }
  });
});
