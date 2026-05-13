#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostAdmissionPolicyFixture,
} from "./nixos-shared-host.fixture";
import {
  readBackendSnapshot,
  readJson,
  writeDemoArtifact,
} from "./nixos-shared-host.control-plane.helpers";
import {
  authRequiredDeployment,
  evidenceWithoutPrincipal,
  postSubmission,
  withArtifactBinding,
  writeAuthSession,
} from "./nixos-shared-host.service-auth-boundary.helpers";

function humanCheckEvidence(deployment: any, subject: string) {
  const { requestedBy: _requestedBy, ...evidence } = deploymentAdmissionEvidenceFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: subject,
    requiredChecks: ["deploy/pleomino-dev"],
  });
  return {
    ...evidence,
    checks: (evidence.checks || []).map((check) => ({ ...check, reportingKind: "human_manual" })),
  };
}

function trustedReporter(deployment: any): string {
  return deployment.lanePolicy.governance.trustedReporterIdentities[0] || "app:deploy-bot";
}

function manualCheck(deployment: any) {
  return {
    name: "deploy/pleomino-dev",
    subject: "sha256:manual",
    status: "passed",
    checkedAt: "2026-04-23T00:00:00.000Z",
    reportingKind: "human_manual",
    reporterIdentity: trustedReporter(deployment),
  };
}

async function startHarness(tmp: string, deployment: any, artifactName: string) {
  const artifactDir = path.join(tmp, artifactName);
  const paths = {
    statePath: path.join(tmp, "platform-state.json"),
    hostRoot: path.join(tmp, "host"),
    recordsRoot: path.join(tmp, "records"),
  };
  await writeDemoArtifact(artifactDir, artifactName);
  const controlPlane = await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths,
    backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    localFixture: true,
  });
  return { artifactDir, controlPlane, paths };
}

async function postCheckedSubmission(opts: {
  controlPlaneUrl: string;
  deployment: any;
  artifactDir: string;
  authSessionId: string;
  admissionEvidence: object;
}) {
  return await postSubmission(
    opts.controlPlaneUrl,
    await withArtifactBinding(opts.controlPlaneUrl, {
      schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: createNixosSharedHostSubmissionId(),
      submittedAt: new Date().toISOString(),
      deployment: opts.deployment,
      operationKind: "deploy",
      authSessionId: opts.authSessionId,
      artifactDir: opts.artifactDir,
      admissionEvidence: opts.admissionEvidence,
    }),
  );
}

test("submitter-only sessions cannot submit client-supplied admission checks", async () => {
  await runInTemp("nixos-service-auth-reporter-required", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const { artifactDir, controlPlane, paths } = await startHarness(tmp, deployment, "artifact");
    try {
      const authSessionId = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:submitter",
        role: "submitter",
      });
      const response = await postCheckedSubmission({
        controlPlaneUrl: controlPlane.url,
        deployment,
        artifactDir,
        authSessionId,
        admissionEvidence: {
          ...evidenceWithoutPrincipal(deployment),
          checks: [manualCheck(deployment)],
        },
      });
      assert.equal(response.status, 403);
      assert.match(await response.text(), /admission_reporter/);
    } finally {
      await controlPlane.close();
    }
  });
});

test("admission_reporter-only sessions still cannot submit a deploy", async () => {
  await runInTemp("nixos-service-auth-submitter-required", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const { artifactDir, controlPlane, paths } = await startHarness(tmp, deployment, "artifact");
    try {
      const authSessionId = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:reporter",
        role: "admission_reporter",
      });
      const response = await postCheckedSubmission({
        controlPlaneUrl: controlPlane.url,
        deployment,
        artifactDir,
        authSessionId,
        admissionEvidence: {
          ...evidenceWithoutPrincipal(deployment),
          checks: [manualCheck(deployment)],
        },
      });
      assert.equal(response.status, 403);
      assert.match(await response.text(), /submitter/);
    } finally {
      await controlPlane.close();
    }
  });
});

test("human submitters with submitter and admission_reporter grants persist manual check provenance", async () => {
  await runInTemp("nixos-service-auth-human-reporting-kind", async (tmp, $) => {
    const deployment = authRequiredDeployment({
      admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
        requiredChecks: ["deploy/pleomino-dev"],
      }),
    });
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const subject = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
    ).trim();
    const { artifactDir, controlPlane, paths } = await startHarness(tmp, deployment, "artifact");
    try {
      const authSessionId = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:human-submitter",
        roles: ["submitter", "admission_reporter"],
      });
      const submitted = await readJson<any>(
        await postCheckedSubmission({
          controlPlaneUrl: controlPlane.url,
          deployment,
          artifactDir,
          authSessionId,
          admissionEvidence: humanCheckEvidence(deployment, subject),
        }),
      );
      const snapshot = await readBackendSnapshot(paths.recordsRoot, submitted.submissionId);
      assert.equal(
        snapshot.admittedContext.policyEvaluation.requiredChecks[0]?.reportingKind,
        "human_manual",
      );
    } finally {
      await controlPlane.close();
    }
  });
});

test("automation principals can submit structured evidence only when they also hold admission_reporter", async () => {
  await runInTemp("nixos-service-auth-automation-reporter", async (tmp, $) => {
    const deployment = authRequiredDeployment({
      admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
        requiredChecks: ["deploy/pleomino-dev"],
      }),
    });
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const subject = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
    ).trim();
    const { artifactDir, controlPlane, paths } = await startHarness(tmp, deployment, "artifact");
    try {
      const authSessionId = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:service-account-jenkins",
        roles: ["submitter", "admission_reporter"],
      });
      const admissionEvidence = humanCheckEvidence(deployment, subject);
      const submitted = await readJson<any>(
        await postCheckedSubmission({
          controlPlaneUrl: controlPlane.url,
          deployment,
          artifactDir,
          authSessionId,
          admissionEvidence: {
            ...admissionEvidence,
            checks: admissionEvidence.checks.map((check) => ({
              ...check,
              recordRef: "check://deploy/pleomino-dev",
              reportingKind: "ci_pipeline",
              reporterIdentity: trustedReporter(deployment),
            })),
          },
        }),
      );
      assert.equal(submitted.authorization.principal.principalId, "oidc:service-account-jenkins");
      const snapshot = await readBackendSnapshot(paths.recordsRoot, submitted.submissionId);
      assert.equal(
        snapshot.admittedContext.policyEvaluation.requiredChecks[0]?.reportingKind,
        "ci_pipeline",
      );
    } finally {
      await controlPlane.close();
    }
  });
});
