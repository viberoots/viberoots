#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildKubernetesControlPlaneSnapshot } from "../../deployments/kubernetes-control-plane-snapshot";
import { KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/kubernetes-control-plane";
import { buildS3StaticControlPlaneSnapshot } from "../../deployments/s3-static-control-plane-snapshot";
import { S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/s3-static-control-plane";
import { buildVercelControlPlaneSnapshot } from "../../deployments/vercel-control-plane-snapshot";
import {
  queueVercelControlPlaneSubmission,
  VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
} from "../../deployments/vercel-control-plane";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { fingerprintValue } from "../../deployments/nixos-shared-host-deployment-fingerprint";
import { runInTemp } from "../lib/test-helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { vercelDeploymentFixture } from "./vercel.fixture";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  deploymentWithVercelSecret,
  withVercelFixtureSecrets,
  writeVercelArtifact,
} from "./vercel.control-plane.helpers";

async function writeStaticArtifact(root: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>frozen</html>\n", "utf8");
  return root;
}

async function writeKubernetesValues(root: string, deploymentId: string) {
  const configPath = path.join(
    root,
    "projects",
    "deployments",
    deploymentId,
    "helm",
    "values.yaml",
  );
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, "chart: ./charts/api\n", "utf8");
}

function assertSharedAdmission(snapshot: Record<string, any>) {
  assert.equal(
    snapshot.frozenExecutionSchemaVersion,
    "deployment-provider-frozen-execution-snapshot@1",
  );
  assert.equal(snapshot.admission.decision, "admitted");
  assert.ok(snapshot.admission.policyEvaluation.binding.payloadFingerprint);
  assert.ok(snapshot.admittedContext.policyEvaluation.binding.payloadFingerprint);
  assert.equal("artifactDir" in snapshot, false);
}

test("provider control-plane preparation freezes shared admission and admitted artifacts", async () => {
  await runInTemp("provider-frozen-snapshots", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const s3 = s3StaticDeploymentFixture();
    const kube = kubernetesDeploymentFixture();
    kube.admissionPolicy.requiredApprovals = [];
    kube.lanePolicy.governance.requiredApprovalBoundaries =
      kube.lanePolicy.governance.requiredApprovalBoundaries.filter(
        (boundary) => boundary.stage !== kube.environmentStage,
      );
    const vercel = vercelDeploymentFixture({
      admissionPolicy: {
        ...vercelDeploymentFixture().admissionPolicy,
        allowedRefs: ["main"],
        requiredChecks: [],
      },
    });
    for (const deployment of [s3, kube, vercel]) {
      deployment.lanePolicy.sourceRefPolicy[deployment.environmentStage] = "main";
      deployment.admissionPolicy.allowedRefs = ["main"];
      deployment.lanePolicy.governance.sourceRefPolicies =
        deployment.lanePolicy.governance.sourceRefPolicies.map((policy) =>
          policy.stage === deployment.environmentStage
            ? {
                ...policy,
                allowedRefs: ["main"],
                requiredChecks: deployment.admissionPolicy.requiredChecks,
              }
            : policy,
        );
      await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    }
    const sourceRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse main`).stdout,
    ).trim();
    const s3Snapshot = await buildS3StaticControlPlaneSnapshot({
      workspaceRoot: tmp,
      recordsRoot,
      request: {
        schemaVersion: S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: "s3-submit",
        submittedAt: new Date().toISOString(),
        deployment: s3,
        operationKind: "deploy",
        artifactDir: await writeStaticArtifact(path.join(tmp, "s3-artifact")),
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment: s3,
          operationKind: "deploy",
          sourceRevision,
        }),
      },
    });
    assertSharedAdmission(s3Snapshot);
    assert.ok(s3Snapshot.artifact?.identity.startsWith("static-webapp:"));

    const serviceArtifact = path.join(tmp, "service-artifact");
    const serviceIdentity = await writeServiceArtifact(serviceArtifact, "service\n");
    await writeKubernetesValues(tmp, kube.deploymentId);
    const kubeArtifactLineageId = fingerprintValue({
      providerTargetIdentity: kube.providerTarget.providerTargetIdentity,
      componentArtifacts: [{ componentId: "api", identity: serviceIdentity }],
    });
    const kubeSnapshot = await buildKubernetesControlPlaneSnapshot({
      workspaceRoot: tmp,
      recordsRoot,
      request: {
        schemaVersion: KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: "kube-submit",
        submittedAt: new Date().toISOString(),
        deployment: kube,
        operationKind: "deploy",
        artifactDir: serviceArtifact,
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment: kube,
          operationKind: "deploy",
          sourceRevision,
          artifactLineageId: kubeArtifactLineageId,
        }),
      },
    });
    assertSharedAdmission(kubeSnapshot);
    assert.equal(kubeSnapshot.componentArtifacts?.[0]?.componentId, "api");

    const vercelArtifact = await writeVercelArtifact(path.join(tmp, "vercel-artifact"));
    const vercelSnapshot = await buildVercelControlPlaneSnapshot({
      workspaceRoot: tmp,
      recordsRoot,
      request: {
        schemaVersion: VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: "vercel-submit",
        submittedAt: new Date().toISOString(),
        deployment: vercel,
        operationKind: "deploy",
        artifactDir: vercelArtifact,
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment: vercel,
          operationKind: "deploy",
          sourceRevision,
        }),
      },
    });
    assertSharedAdmission(vercelSnapshot);
    assert.ok(vercelSnapshot.artifact?.identity.startsWith("vercel-next:"));
    assert.ok(vercelSnapshot.artifact?.outputDir.startsWith(path.join(recordsRoot, "artifacts")));
  });
});

test("provider snapshot preparation rejects denied admission and queues admitted snapshots", async () => {
  await runInTemp("provider-frozen-admission-outcomes", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const s3 = s3StaticDeploymentFixture();
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, s3);
    await assert.rejects(
      buildS3StaticControlPlaneSnapshot({
        workspaceRoot: tmp,
        recordsRoot,
        request: {
          schemaVersion: S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
          submissionId: "s3-denied",
          submittedAt: new Date().toISOString(),
          deployment: s3,
          operationKind: "deploy",
          artifactDir: await writeStaticArtifact(path.join(tmp, "s3-denied-artifact")),
        },
      }),
      /lane governance|admission evidence|shared control-plane mutation rejected/,
    );

    const secretful = deploymentWithVercelSecret();
    const vercel = vercelDeploymentFixture({
      secretRequirements: secretful.secretRequirements,
      admissionPolicy: {
        ...secretful.admissionPolicy,
        allowedRefs: ["main"],
        requiredChecks: [],
      },
    });
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, vercel);
    await withVercelFixtureSecrets(
      {
        "vercel/api-token": {
          value: "token",
          allowedSteps: ["publish", "smoke"],
          targetScopes: ["*"],
        },
      },
      async () => {
        const queued = await queueVercelControlPlaneSubmission({
          workspaceRoot: tmp,
          recordsRoot,
          backend: { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) },
          request: {
            schemaVersion: VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
            submissionId: "vercel-queued",
            submittedAt: new Date().toISOString(),
            deployment: vercel,
            operationKind: "deploy",
            artifactDir: await writeVercelArtifact(path.join(tmp, "vercel-queued-artifact")),
            admissionEvidence: deploymentAdmissionEvidenceFixture({
              deployment: vercel,
              operationKind: "deploy",
              sourceRevision: String(
                (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse main`).stdout,
              ).trim(),
            }),
          },
        });
        assert.equal(queued.lifecycleState, "queued");
      },
    );
  });
});
