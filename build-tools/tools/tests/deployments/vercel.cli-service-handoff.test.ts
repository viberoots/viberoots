#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { VercelDeployment } from "../../deployments/contract";
import { createDeploymentAdmissionBinding } from "../../deployments/deployment-admission-binding";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import { resolveDeploymentReviewedTargetEnvironment } from "../../deployments/deployment-reviewed-target-environment";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendSubmissionBySubmissionId,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import {
  createVercelDeployRecord,
  writeVercelDeployRecord,
} from "../../deployments/vercel-records";
import { writeVercelReplaySnapshot } from "../../deployments/vercel-replay";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  appendTargetsFragment,
  labelDir,
  labelName,
  writeReconciledTargetsFragments,
} from "./deployment-targets.install.fragments";
import { renderRequirementList, renderStringRecordList } from "./deployment-targets.install.render";
import { sharedPolicyTargetsByDir } from "./deployment-targets.install.shared-policies";
import {
  deploymentWithVercelCleanupSecret,
  deploymentWithVercelSecret,
  startVercelQueueOnlyService,
} from "./vercel.control-plane.helpers";
import { readBackendSnapshot } from "./nixos-shared-host.control-plane.helpers";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { installHarnessClientProfile } from "./nixos-shared-host.remote-exec.install.helpers";
import { vercelDeploymentFixture } from "./vercel.fixture";

type OperationKind = "deploy" | "preview" | "preview_cleanup" | "retry" | "rollback";
function protectedVercelDeployment(): VercelDeployment {
  const lanePolicy = nixosSharedHostLanePolicyFixture({ defaultClientProfile: "mini" });
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/sample-webapp/shared:staging_release",
    name: "staging_release",
    allowedRefs: ["main"],
    requiredChecks: [],
  });
  return vercelDeploymentFixture({
    lanePolicy,
    admissionPolicy,
    environmentStage: "staging",
    secretRequirements: [
      ...deploymentWithVercelSecret().secretRequirements,
      ...deploymentWithVercelCleanupSecret().secretRequirements,
    ],
  });
}
async function installVercelTargets(tmp: string, deployment: VercelDeployment) {
  const fragments = sharedPolicyTargetsByDir([deployment as any]);
  appendTargetsFragment(fragments, labelDir(deployment.component.target), {
    loadLines: ['load("@prelude//:rules.bzl", "genrule")'],
    bodyLines: [
      "genrule(",
      `    name = ${JSON.stringify(labelName(deployment.component.target))},`,
      '    out = "app.txt",',
      '    cmd = "printf console > $OUT",',
      '    labels = ["kind:app", "webapp:ssr"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ],
  });
  appendTargetsFragment(fragments, labelDir(deployment.label), {
    loadLines: [
      'load("@viberoots//build-tools/deployments:defs.bzl", "vercel_next_webapp_deployment")',
    ],
    bodyLines: [
      "vercel_next_webapp_deployment(",
      `    name = ${JSON.stringify(deployment.name)},`,
      `    component = ${JSON.stringify(deployment.component.target)},`,
      `    team = ${JSON.stringify(deployment.providerTarget.team)},`,
      `    project = ${JSON.stringify(deployment.providerTarget.project)},`,
      `    environment = ${JSON.stringify(deployment.providerTarget.environment)},`,
      `    canonical_url = ${JSON.stringify(deployment.providerTarget.canonicalUrl)},`,
      `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
      `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
      `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
      `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
      "    secret_requirements =",
      ...renderStringRecordList(renderRequirementList(deployment.secretRequirements)),
      ")",
      "",
    ],
  });
  await writeReconciledTargetsFragments(tmp, fragments);
  const configDir = path.join(tmp, labelDir(deployment.label));
  await fsp.writeFile(path.join(configDir, "vercel-prebuilt.jsonc"), '{"mode":"prebuilt"}\n');
}

function sourceAdmittedContext(tmp: string, deployment: VercelDeployment, target: any) {
  const artifactIdentity = "vercel-prebuilt:source-artifact";
  return {
    lanePolicyRef: deployment.lanePolicyRef,
    lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
    admissionPolicyRef: deployment.admissionPolicyRef,
    admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
    environmentStage: deployment.environmentStage,
    secretRequirements: deployment.secretRequirements,
    admittedSecretReferences: deployment.secretRequirements.map((requirement) => ({
      ...requirement,
      backend: "vault",
      referenceId: `vault:${requirement.contractId}`,
      targetScope: deployment.providerTarget.providerTargetIdentity,
      backendRef: `secret://deployments/${requirement.contractId}`,
      selectorRef: requirement.contractId,
      resolvedAt: "2026-04-06T12:00:00.000Z",
      resolvedVersion: "1",
      refreshMode: "none",
      credentialClass: "routine",
    })),
    runtimeConfigRequirements: [],
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references",
      runtimeConfig: "exact_contract_ids",
    },
    targetExceptionRefs: [],
    source: {
      mode: "reviewed_source_ref",
      sourceRef: target.targetRef,
      sourceRevision: target.targetRevision,
      artifactIdentity,
      artifactTrustMode: "recorded_exact_artifact",
    },
    targetEnvironment: target,
    policyEvaluation: {
      binding: createDeploymentAdmissionBinding({
        deployment,
        sourceRevision: target.targetRevision,
        artifactIdentity,
        artifactLineageId: artifactIdentity,
      }),
    },
    workspaceRoot: tmp,
  };
}

async function seedReplaySource(tmp: string, recordsRoot: string, deployment: VercelDeployment) {
  const deployRunId = "vercel-source-run";
  const target = await resolveDeploymentReviewedTargetEnvironment({
    workspaceRoot: tmp,
    deployment,
  });
  const admittedContext = sourceAdmittedContext(tmp, deployment, target);
  const artifact = { identity: admittedContext.source.artifactIdentity };
  const replaySnapshotPath = await writeVercelReplaySnapshot({
    recordsRoot,
    deployRunId,
    deployment,
    artifact,
    providerReleaseId: "dpl_source",
    publicUrl: "https://console-staging.vercel.app/",
    aliasAssigned: true,
    providerConfigFingerprint: "sha256:vercel-config",
    admittedContext: admittedContext as any,
  });
  await writeVercelDeployRecord(
    recordsRoot,
    createVercelDeployRecord(deployment, {
      deployRunId,
      operationKind: "deploy",
      runClassification: "deploy",
      finalOutcome: "succeeded",
      artifact,
      providerReleaseId: "dpl_source",
      publicUrl: "https://console-staging.vercel.app/",
      aliasAssigned: true,
      releaseLineageId: deployRunId,
      artifactLineageId: artifact.identity,
      providerConfigFingerprint: "sha256:vercel-config",
      replaySnapshotPath,
      admittedContext,
    }),
  );
  return deployRunId;
}

function clientEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    VBR_DEPLOY_CONTROL_PLANE_TOKEN: "test-control-plane-token",
  };
  delete env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  return env;
}

test("protected Vercel CLI queues deploy preview cleanup retry and rollback through service", async () => {
  await runInTemp("vercel-cli-service-handoff", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const initial = protectedVercelDeployment();
    await installVercelTargets(tmp, initial);
    const deployment = (await resolveDeploymentFromTarget(tmp, initial.label)) as VercelDeployment;
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    const evidence = await writeReviewedLaneAdmissionEvidenceJson({ tmp, $, deployment });
    const sourceRunId = await seedReplaySource(tmp, recordsRoot, deployment);
    const service = await startVercelQueueOnlyService(tmp, recordsRoot);
    try {
      const profileRoot = await installHarnessClientProfile($, tmp, service.url);
      for (const [operationKind, flags] of [
        ["deploy", []],
        ["preview", ["--preview"]],
        ["preview_cleanup", ["--preview-cleanup"]],
        ["retry", ["--publish-only"]],
        ["rollback", ["--publish-only", "--rollback"]],
      ] as [OperationKind, string[]][]) {
        const run = await $({
          cwd: tmp,
          env: clientEnv(),
          stdio: "pipe",
        })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deployment.label} --admission-evidence-json ${evidence} --source-run-id ${sourceRunId} --profile-root ${profileRoot} ${flags}`;
        const summary = JSON.parse(String(run.stdout));
        assert.equal(summary.lifecycleState, "finished");
        assert.equal(summary.operationKind, operationKind);
        const submission = await readBackendSubmissionBySubmissionId(
          {
            recordsRoot,
            databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
          },
          summary.submissionId,
        );
        assert.equal(submission?.lifecycleState, "queued");
        assert.equal(submission?.operationKind, operationKind);
        assert.equal(submission?.dedupe?.mode, "created");
        const snapshot = await readBackendSnapshot(recordsRoot, summary.submissionId);
        assert.equal(snapshot.operationKind, operationKind);
        assert.equal(snapshot.sourceRunId, sourceRunId);
        assert.equal(snapshot.replaySnapshot.deployRunId, sourceRunId);
        assert.equal(snapshot.admission.decision, "admitted");
        assert.equal(snapshot.deployment.provider, "vercel");
      }
    } finally {
      await service.close();
    }
  });
});
