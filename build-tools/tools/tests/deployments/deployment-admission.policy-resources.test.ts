#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("admission evaluation includes first-class policy resource refs and versions", async () => {
  const deployment = {
    ...nixosSharedHostDeploymentFixture({
      admissionPolicy: {
        ...nixosSharedHostDeploymentFixture().admissionPolicy,
        readinessGates: [
          {
            name: "github-install",
            type: "github_selected_repository_install",
            requiredFor: ["rollback"],
            gateVersion: "gate-release",
          },
        ],
        attestation: {
          trustedBuilderIdentities: ["builder:trusted"],
          acceptedProvenanceFormats: ["slsa-provenance-release"],
          artifactBinding: "source_revision_and_build_inputs",
          expiredBehavior: "fail_closed",
          revokedBehavior: "fail_closed",
          trustDriftBehavior: "fail_closed",
          signatureRequired: false,
          trustedSignerIdentities: [],
        },
        sbom: { required: true, acceptedFormats: ["cyclonedx-json"] },
        supplyChainGates: [
          { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
        ],
      },
      rolloutPolicy: {
        mode: "all_at_once",
        abort: "stop_on_first_failure",
        smoke: "final_only",
        steps: [],
      },
      smoke: { runnerClass: "http_5m" },
    }),
    preview: {
      targetDerivation: "branch",
      isolationClass: "ephemeral",
      identitySelector: "branch",
      cleanupTtl: "7d",
      smokeTarget: "preview_url",
      lockScope: "preview",
    },
  };
  const admittedContext = admittedContextFixture(deployment);
  const evaluation = await evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision: admittedContext.source.sourceRevision,
        artifactIdentity: admittedContext.source.artifactIdentity,
        buildInputsFingerprint: "sha256:build-inputs",
        provenanceFormat: "slsa-provenance-release",
        supplyChainGates: [
          { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
        ],
      }),
    }),
  });
  const refs = new Map(evaluation.policyResourceRefs.map((ref) => [ref.kind, ref]));
  assert.equal(refs.get("LanePolicy")?.version, deployment.lanePolicy.fingerprint);
  assert.equal(refs.get("AdmissionPolicy")?.version, deployment.admissionPolicy.fingerprint);
  assert.equal(refs.get("ReadinessGatePolicy")?.version, "gate-release");
  assert.equal(refs.get("RolloutPolicy")?.resourceId, `${deployment.deploymentId}:rollout`);
  assert.equal(refs.get("PreviewPolicy")?.resourceId, `${deployment.deploymentId}:preview`);
  assert.equal(refs.get("SmokePolicy")?.resourceId, `${deployment.deploymentId}:smoke`);
  assert.equal(refs.get("AttestationPolicy")?.resourceId, `${deployment.deploymentId}:attestation`);
  assert.equal(refs.get("SbomPolicy")?.resourceId, `${deployment.deploymentId}:sbom`);
  assert.equal(refs.get("ProviderCapabilityPolicy")?.version, "provider-capability@1");
});
