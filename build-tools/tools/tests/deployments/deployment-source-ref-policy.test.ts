#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { resolveReviewedSourceRevision } from "../../deployments/deployment-reviewed-source-ref";
import { sourceRefPolicyKind } from "../../deployments/deployment-source-ref-policy";
import { snapshotReviewedSourceForSubmission } from "../../deployments/nixos-shared-host-reviewed-source-snapshot";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";

const execFileAsync = promisify(execFile);

function deploymentForSourceRef(sourceRef: string, allowedRefs: string[]) {
  return nixosSharedHostDeploymentFixture({
    lanePolicy: nixosSharedHostLanePolicyFixture({
      sourceRefPolicy: { dev: sourceRef },
      governance: nixosSharedHostLaneGovernanceFixture({
        scmBackend: "git",
        repository: "",
      }),
    }),
    admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
      allowedRefs,
      requiredChecks: ["deploy/demoapp-dev"],
    }),
  });
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return String(stdout || "").trim();
}

test("reviewed source policy classifies main, release tags, and explicit commits", () => {
  assert.equal(sourceRefPolicyKind("main"), "protected_main");
  assert.equal(sourceRefPolicyKind("refs/tags/release/2026.05.12"), "release_tag");
  assert.equal(
    sourceRefPolicyKind("commit:0123456789abcdef0123456789abcdef01234567"),
    "explicit_reviewed_commit",
  );
});

test("reviewed source policy resolves an explicit reviewed commit without git ref lookup", async () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const resolved = await resolveReviewedSourceRevision({
    workspaceRoot: "/not-used",
    deployment: deploymentForSourceRef(`commit:${sha}`, [`commit:${sha}`]),
    resolveGitRevision: async () => {
      throw new Error("git lookup should not run for explicit reviewed commits");
    },
  });
  assert.deepEqual(resolved, {
    ref: `commit:${sha}`,
    kind: "explicit_reviewed_commit",
    sha,
  });
});

test("reviewed source policy admits an explicit commit selected by the request", async () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const resolved = await resolveReviewedSourceRevision({
    workspaceRoot: "/not-used",
    deployment: deploymentForSourceRef("main", ["main", "commit:*"]),
    requestedSourceRef: `commit:${sha}`,
    resolveGitRevision: async () => {
      throw new Error("git lookup should not run for explicit reviewed commits");
    },
  });
  assert.deepEqual(resolved, {
    ref: `commit:${sha}`,
    kind: "explicit_reviewed_commit",
    sha,
  });
});

test("reviewed source policy requires a concrete request for release tag classes", async () => {
  await assert.rejects(
    resolveReviewedSourceRevision({
      workspaceRoot: "/not-used",
      deployment: deploymentForSourceRef("refs/tags/release/*", ["refs/tags/release/*"]),
      resolveGitRevision: async () => "unused",
    }),
    /requires an explicit reviewed source ref selected by the request/,
  );
});

test("reviewed source policy resolves a concrete release tag selected by the request", async () => {
  const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const resolved = await resolveReviewedSourceRevision({
    workspaceRoot: "/not-used",
    deployment: deploymentForSourceRef("refs/tags/release/*", ["refs/tags/release/*"]),
    requestedSourceRef: "refs/tags/release/2026.05.12",
    resolveGitRevision: async (_workspaceRoot, revision) => {
      assert.equal(revision, "refs/tags/release/2026.05.12");
      return sha;
    },
  });
  assert.deepEqual(resolved, {
    ref: "refs/tags/release/2026.05.12",
    kind: "release_tag",
    sha,
  });
});

test("reviewed source snapshot fetches a concrete release tag selected by the request", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "reviewed-source-release-tag-"));
  const remote = path.join(tmp, "origin.git");
  const work = path.join(tmp, "work");
  await fsp.mkdir(work);
  await git(tmp, ["init", "--bare", remote]);
  await git(work, ["init"]);
  await git(work, ["config", "user.email", "deploy@example.test"]);
  await git(work, ["config", "user.name", "Deploy Test"]);
  await fsp.writeFile(path.join(work, "README.md"), "release\n", "utf8");
  await git(work, ["add", "README.md"]);
  await git(work, ["commit", "-m", "release"]);
  const releaseSha = await git(work, ["rev-parse", "HEAD"]);
  await git(work, ["tag", "release/2026.05.12"]);
  await git(work, ["remote", "add", "origin", remote]);
  await git(work, ["push", "origin", "HEAD:refs/heads/main"]);
  await git(work, ["push", "origin", "refs/tags/release/2026.05.12"]);

  const snapshot = await snapshotReviewedSourceForSubmission({
    workspaceRoot: work,
    deployment: deploymentForSourceRef("refs/tags/release/*", ["refs/tags/release/*"]),
    submissionId: "submission-release-tag",
    requestedSourceRef: "refs/tags/release/2026.05.12",
    expectedSourceRevision: releaseSha,
  });
  assert.equal(snapshot.reviewedRef, "refs/tags/release/2026.05.12");
  assert.equal(snapshot.sourceRevision, releaseSha);
  assert.equal(await git(work, ["rev-parse", `${snapshot.snapshotRef}^{commit}`]), releaseSha);
});

test("release-tag admitted source satisfies required checks and approvals", async () => {
  const sourceRevision = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const deployment = nixosSharedHostDeploymentFixture({
    lanePolicy: nixosSharedHostLanePolicyFixture({
      sourceRefPolicy: { dev: "refs/tags/release/*" },
    }),
    admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
      allowedRefs: ["refs/tags/release/*"],
      requiredChecks: ["deploy/demoapp-dev"],
      requiredApprovals: ["release/dev"],
    }),
  });
  const admittedContext = admittedContextFixture(deployment, { sourceRevision });
  const evaluation = await evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision,
        artifactIdentity: admittedContext.source.artifactIdentity,
        requiredChecks: ["deploy/demoapp-dev"],
        requiredApprovals: ["release/dev"],
      }),
    }),
  });
  assert.equal(evaluation.binding.sourceRevision, sourceRevision);
  assert.equal(evaluation.requiredChecks[0]?.name, "deploy/demoapp-dev");
  assert.equal(evaluation.requiredChecks[0]?.subject, sourceRevision);
  assert.equal(evaluation.requiredApprovals[0]?.status, "fresh");
});

test("reviewed source policy rejects normal protected/shared env refs at runtime", async () => {
  await assert.rejects(
    resolveReviewedSourceRevision({
      workspaceRoot: "/not-used",
      deployment: deploymentForSourceRef("env/demo/dev", ["env/demo/dev"]),
      resolveGitRevision: async () => "unused",
    }),
    /source_ref_policy must not use environment branch env\/demo\/dev/,
  );
});

test("reviewed source policy rejects refs outside admission allowed_refs", async () => {
  await assert.rejects(
    resolveReviewedSourceRevision({
      workspaceRoot: "/not-used",
      deployment: deploymentForSourceRef("main", ["refs/tags/release/*"]),
      resolveGitRevision: async () => "unused",
    }),
    /does not allow source ref main/,
  );
});
