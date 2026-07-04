#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("CI admission evidence is retained when it matches source and immutable artifact identity", async () => {
  const deployment = nixosSharedHostDeploymentFixture();
  const admittedContext = admittedContextFixture(deployment, {
    artifactIdentity: "static-webapp:abc123",
  });
  const evaluation = await evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: {
        ...reviewedLaneAdmissionEvidenceFixture({ deployment, requestedBy: "app:jenkins" }),
        requestedBy: { principalId: "app:jenkins" },
        ciSubmission: {
          system: "jenkins",
          sourceRevision: admittedContext.source.sourceRevision,
          builderIdentity: "jenkins:mini/main",
          artifactIdentity: "static-webapp:abc123",
          artifactRef: "registry.example.test/sample-webapp@sha256:abcd",
          idempotencyKey: "jenkins-main-123",
          sbomRefs: ["oci://sbom/sample-webapp@sha256:beef"],
          signatureRefs: ["sigstore://sample-webapp/123"],
          provenanceRefs: ["slsa://jenkins/123"],
        },
      },
    }),
  });
  assert.equal(evaluation.ciSubmission?.system, "jenkins");
  assert.equal(evaluation.ciSubmission?.builderIdentity, "jenkins:mini/main");
  assert.equal(evaluation.ciSubmission?.idempotencyKey, "jenkins-main-123");
});

test("CI admission evidence rejects mutable image tags and mismatched artifacts", async () => {
  const deployment = nixosSharedHostDeploymentFixture();
  const admittedContext = admittedContextFixture(deployment, {
    artifactIdentity: "static-webapp:abc123",
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ciSubmission: {
            system: "jenkins",
            sourceRevision: admittedContext.source.sourceRevision,
            builderIdentity: "jenkins:mini/main",
            artifactIdentity: "static-webapp:abc123",
            artifactRef: "registry.example.test/sample-webapp:latest",
          },
        },
      }),
    }),
    /mutable image tag/,
  );
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ciSubmission: {
            system: "jenkins",
            sourceRevision: admittedContext.source.sourceRevision,
            builderIdentity: "jenkins:mini/main",
            artifactIdentity: "static-webapp:wrong",
            artifactRef: "retained-artifact://jenkins/sample-webapp-dev/1",
          },
        },
      }),
    }),
    /does not match admitted artifact identity/,
  );
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ciSubmission: {
            system: "jenkins",
            sourceRevision: admittedContext.source.sourceRevision,
            builderIdentity: "jenkins:mini/main",
            artifactIdentity: "static-webapp:abc123",
            artifactRef: "/tmp/jenkins/workspace/sample-webapp/dist",
          },
        },
      }),
    }),
    /laptop-local/,
  );
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ciSubmission: {
            system: "jenkins",
            sourceRevision: admittedContext.source.sourceRevision,
            builderIdentity: "jenkins:mini/main",
            artifactIdentity: "static-webapp:abc123",
            artifactRef: "dist/build-output",
          },
        },
      }),
    }),
    /immutable digest or retained artifact ref/,
  );
});
