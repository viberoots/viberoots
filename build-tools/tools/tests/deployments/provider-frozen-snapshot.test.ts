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
import { runInTemp } from "../lib/test-helpers";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { vercelDeploymentFixture } from "./vercel.fixture";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import {
  deploymentWithVercelSecret,
  withVercelFixtureSecrets,
  writeVercelArtifact,
} from "./vercel.control-plane.helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";

async function writeStaticArtifact(root: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>frozen</html>\n", "utf8");
  return root;
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
    const vercel = vercelDeploymentFixture({
      admissionPolicy: {
        ...vercelDeploymentFixture().admissionPolicy,
        allowedRefs: ["env/pleomino/staging"],
        requiredChecks: [],
      },
    });
    for (const deployment of [s3, kube, vercel]) {
      await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    }
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
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment: s3 }),
      },
    });
    assertSharedAdmission(s3Snapshot);
    assert.ok(s3Snapshot.artifact?.identity.startsWith("static-webapp:"));

    const serviceArtifact = path.join(tmp, "service-artifact");
    await writeServiceArtifact(serviceArtifact, "service\n");
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
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment: kube }),
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
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment: vercel }),
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
    await ensureNixosSharedHostStageBranch(tmp, $, s3);
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
        allowedRefs: ["env/pleomino/staging"],
        requiredChecks: [],
      },
    });
    await ensureNixosSharedHostStageBranch(tmp, $, vercel);
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
            admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment: vercel }),
          },
        });
        assert.equal(queued.lifecycleState, "queued");
      },
    );
  });
});
