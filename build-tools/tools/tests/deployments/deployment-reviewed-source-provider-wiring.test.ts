#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { resolveInitialAppStoreConnectAdmittedContext } from "../../deployments/app-store-connect-admission";
import { submitAppStoreConnectDeploy } from "../../deployments/app-store-connect-deploy";
import type { DeploymentAdmissionOperationKind } from "../../deployments/deployment-admission-binding";
import type { DeploymentAdmissionEvidence } from "../../deployments/deployment-admission-evidence";
import { resolveInitialGooglePlayAdmittedContext } from "../../deployments/google-play-admission";
import { submitGooglePlayDeploy } from "../../deployments/google-play-deploy";
import { resolveInitialOpenTofuAdmittedContext } from "../../deployments/opentofu-admission";
import { submitOpenTofuFoundationProvisionOnly } from "../../deployments/opentofu-foundation-provision-only";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  reviewedLaneAdmissionEvidenceFixture,
  nixosSharedHostLaneGovernanceFixture,
} from "./deployment-lane-governance.fixture";
import { appStoreConnectDeploymentFixture } from "./app-store-connect.fixture";
import { writeAppStoreConnectConfig } from "./app-store-connect.e2e.helpers";
import { googlePlayDeploymentFixture } from "./google-play.fixture";
import { writeGooglePlayConfig } from "./google-play.e2e.helpers";
import {
  recordingApplyAdapter,
  writeOpenTofuStackFixture,
} from "./kubernetes.opentofu-apply.integration.helpers";
import { writeMobileArtifact } from "./mobile-release.e2e.helpers";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import {
  foundationDeploymentFixture,
  migrationAdapter,
  writeMigrationBundleFixture,
} from "./opentofu-foundation-migration.helpers";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return String(stdout || "").trim();
}

async function releaseTagWorkspace() {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), "provider-reviewed-source-"));
  await git(work, ["init"]);
  await git(work, ["config", "user.email", "deploy@example.test"]);
  await git(work, ["config", "user.name", "Deploy Test"]);
  await fsp.writeFile(path.join(work, "README.md"), "release\n", "utf8");
  await git(work, ["add", "README.md"]);
  await git(work, ["commit", "-m", "release"]);
  const sha = await git(work, ["rev-parse", "HEAD"]);
  await git(work, ["tag", "release/2026.05.13"]);
  return { work, sha, tagRef: "refs/tags/release/2026.05.13" };
}

function reviewedReleasePolicy() {
  const lanePolicy = nixosSharedHostLanePolicyFixture({
    governance: nixosSharedHostLaneGovernanceFixture({
      sourceRefPolicies: [
        { stage: "dev", allowedRefs: ["refs/tags/release/*"], requiredChecks: [] },
      ],
    }),
    sourceRefPolicy: { dev: "refs/tags/release/*" },
  });
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    allowedRefs: ["refs/tags/release/*"],
    requiredChecks: [],
    requiredApprovals: [],
  });
  return { lanePolicy, admissionPolicy };
}

function foundationWithReviewedReleasePolicy() {
  const { lanePolicy, admissionPolicy } = reviewedReleasePolicy();
  const deployment = foundationDeploymentFixture();
  return {
    ...deployment,
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    secretRequirements: [],
  };
}

function reviewedSourceEvidence(opts: {
  deployment: any;
  operationKind: DeploymentAdmissionOperationKind;
  sourceRevision: string;
  sourceRef: string;
}): DeploymentAdmissionEvidence {
  return {
    ...deploymentAdmissionEvidenceFixture({
      deployment: opts.deployment,
      operationKind: opts.operationKind,
      sourceRevision: opts.sourceRevision,
    }),
    ...reviewedLaneAdmissionEvidenceFixture({ deployment: opts.deployment }),
    reviewedSource: { ref: opts.sourceRef, revision: opts.sourceRevision },
  };
}

test("protected/shared providers consume requested concrete release-tag source refs", async () => {
  const { work, sha, tagRef } = await releaseTagWorkspace();
  const { lanePolicy, admissionPolicy } = reviewedReleasePolicy();
  const providers = [
    {
      name: "app-store-connect",
      resolve: () =>
        resolveInitialAppStoreConnectAdmittedContext({
          workspaceRoot: work,
          deployment: appStoreConnectDeploymentFixture({ lanePolicy, admissionPolicy }),
          artifactIdentity: "mobile-app:ios",
          requestedSourceRef: tagRef,
        }),
    },
    {
      name: "google-play",
      resolve: () =>
        resolveInitialGooglePlayAdmittedContext({
          workspaceRoot: work,
          deployment: googlePlayDeploymentFixture({ lanePolicy, admissionPolicy }),
          artifactIdentity: "mobile-app:android",
          requestedSourceRef: tagRef,
        }),
    },
    {
      name: "opentofu",
      resolve: () =>
        resolveInitialOpenTofuAdmittedContext({
          workspaceRoot: work,
          deployment: foundationWithReviewedReleasePolicy(),
          artifactIdentity: "migration-bundle://foundation",
          requestedSourceRef: tagRef,
        }),
    },
  ];

  for (const provider of providers) {
    const admittedContext = await provider.resolve();
    assert.equal(admittedContext.source.sourceRef, tagRef, provider.name);
    assert.equal(admittedContext.source.sourceRevision, sha, provider.name);
    assert.equal(admittedContext.targetEnvironment.targetRef, tagRef, provider.name);
    assert.equal(admittedContext.targetEnvironment.targetRevision, sha, provider.name);
  }
});

test("mobile deploy entry points pass requested release-tag source refs into admission", async () => {
  const { work, sha, tagRef } = await releaseTagWorkspace();
  const { lanePolicy, admissionPolicy } = reviewedReleasePolicy();
  const ios = appStoreConnectDeploymentFixture({ lanePolicy, admissionPolicy });
  const android = googlePlayDeploymentFixture({ lanePolicy, admissionPolicy });
  const iosArtifact = path.join(work, "artifacts", "release.ipa");
  const androidArtifact = path.join(work, "artifacts", "release.aab");
  await writeMobileArtifact(iosArtifact, "ios\n");
  await writeMobileArtifact(androidArtifact, "android\n");
  await writeAppStoreConnectConfig(work, ios);
  await writeGooglePlayConfig(work, android);

  const iosRun = await submitAppStoreConnectDeploy({
    workspaceRoot: work,
    deployment: ios,
    artifactPath: iosArtifact,
    recordsRoot: path.join(work, "records", "ios"),
    admissionEvidence: reviewedSourceEvidence({
      deployment: ios,
      operationKind: "deploy",
      sourceRevision: sha,
      sourceRef: tagRef,
    }),
  });
  const androidRun = await submitGooglePlayDeploy({
    workspaceRoot: work,
    deployment: android,
    artifactPath: androidArtifact,
    recordsRoot: path.join(work, "records", "android"),
    admissionEvidence: reviewedSourceEvidence({
      deployment: android,
      operationKind: "deploy",
      sourceRevision: sha,
      sourceRef: tagRef,
    }),
  });

  assert.equal(iosRun.record.admittedContext.source.sourceRef, tagRef);
  assert.equal(iosRun.record.admittedContext.source.sourceRevision, sha);
  assert.equal(androidRun.record.admittedContext.source.sourceRef, tagRef);
  assert.equal(androidRun.record.admittedContext.source.sourceRevision, sha);
});

test("OpenTofu provision entry point passes requested release-tag source refs into admission", async () => {
  const { work, sha, tagRef } = await releaseTagWorkspace();
  const deployment = foundationWithReviewedReleasePolicy();
  const bundle = await writeMigrationBundleFixture(work);
  await writeOpenTofuStackFixture({ workspaceRoot: work, deploymentId: deployment.deploymentId });
  const run = await submitOpenTofuFoundationProvisionOnly({
    workspaceRoot: work,
    deployment,
    recordsRoot: path.join(work, "records", "opentofu"),
    migrationBundleArtifactPath: bundle,
    admissionEvidence: reviewedSourceEvidence({
      deployment,
      operationKind: "provision_only",
      sourceRevision: sha,
      sourceRef: tagRef,
    }),
    hooks: {
      openTofuAdapter: recordingApplyAdapter({ stdout: "tofu ok" }).adapter,
      migrationAdapter: migrationAdapter([]),
      secretRuntimeFactory: () => ({
        async enterStep() {
          return {
            "opentofu-provider-credentials": "secret-opentofu",
            "supabase-service-role": "secret-supabase",
          };
        },
      }),
    },
  });

  assert.equal(run.record.admittedContext.source.sourceRef, tagRef);
  assert.equal(run.record.admittedContext.source.sourceRevision, sha);
});
