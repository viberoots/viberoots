#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);

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

test("github reviewed-source fetch env can use GitHub App credential files", async () => {
  await runInTemp("nixos-reviewed-source-github-app", async (tmp) => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const appId = path.join(tmp, "reviewed-source-github-app-id");
    const installationId = path.join(tmp, "reviewed-source-github-app-installation-id");
    const privateKeyFile = path.join(tmp, "reviewed-source-github-app-private-key");
    await fsp.writeFile(appId, "12345");
    await fsp.writeFile(installationId, "67890");
    await fsp.writeFile(
      privateKeyFile,
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    const result = await gitFetchEnvForReviewedRemote(
      tmp,
      "git@github.com:owner/repo.git",
      {
        mode: "github-app",
        githubAppIdFile: appId,
        githubAppInstallationIdFile: installationId,
        githubAppPrivateKeyFile: privateKeyFile,
      },
      {
        githubAppTokenExchange: async (opts) => {
          assert.equal(opts.appId, "12345");
          assert.equal(opts.installationId, "67890");
          assert.match(opts.jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
          return "ghs_fixture_token";
        },
      },
    );
    try {
      assert.equal(result.env?.GIT_TERMINAL_PROMPT, "0");
      assert.match(result.env?.GIT_CONFIG_VALUE_0 || "", /git@github\.com:/);
      assert.doesNotMatch(JSON.stringify(result.env), /ghs_fixture_token/);
    } finally {
      await result.cleanup();
    }
  });
});

test("live-gated GitHub App reviewed-source fetch resolves a remote ref", async (t) => {
  if (process.env.VBR_REVIEWED_SOURCE_GITHUB_APP_LIVE !== "1") {
    t.skip("set VBR_REVIEWED_SOURCE_GITHUB_APP_LIVE=1 to fetch with live GitHub App credentials");
    return;
  }
  await runInTemp("nixos-reviewed-source-github-app-live", async (tmp) => {
    const repository = String(process.env.VBR_REVIEWED_SOURCE_GITHUB_REPOSITORY || "").trim();
    const credentials = {
      mode: "github-app" as const,
      githubAppIdFile: String(process.env.VBR_REVIEWED_SOURCE_GITHUB_APP_ID_FILE || "").trim(),
      githubAppInstallationIdFile: String(
        process.env.VBR_REVIEWED_SOURCE_GITHUB_APP_INSTALLATION_ID_FILE || "",
      ).trim(),
      githubAppPrivateKeyFile: String(
        process.env.VBR_REVIEWED_SOURCE_GITHUB_APP_PRIVATE_KEY_FILE || "",
      ).trim(),
    };
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    const result = await gitFetchEnvForReviewedRemote(
      tmp,
      `git@github.com:${repository}.git`,
      credentials,
    );
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-remote", `git@github.com:${repository}.git`, "HEAD"],
        { cwd: tmp, env: result.env, timeout: 30_000, maxBuffer: 1024 * 1024 },
      );
      assert.match(stdout, /^[0-9a-f]{40}\s+HEAD/m);
    } finally {
      await result.cleanup();
    }
  });
});
