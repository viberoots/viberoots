#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { extractDeploymentAdmissionPolicies } from "../../deployments/deployment-policy";
import {
  admissionBindingFixture,
  deploymentAdmissionEvidenceFixture,
} from "./deployment-admission.fixture";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";

test("admission policy extraction preserves attestation, SBOM, and supply-chain policy fields", () => {
  const { policies, errors } = extractDeploymentAdmissionPolicies([
    nixosSharedHostAdmissionPolicyNodeFixture({
      trusted_builder_identities: ["builder:trusted"],
      accepted_provenance_formats: ["slsa_provenance_v1"],
      artifact_binding: "source_revision_and_build_inputs",
      expired_attestation_behavior: "fail_closed",
      revoked_attestation_behavior: "fail_closed",
      attestation_trust_drift_behavior: "fail_closed",
      require_artifact_signatures: true,
      trusted_signer_identities: ["signer:trusted"],
      sbom_required: true,
      accepted_sbom_formats: ["cyclonedx-json"],
      supply_chain_gates: [
        { name: "vuln/critical", category: "vulnerability", apply_at: "build_admission" },
        { name: "license/allowlist", category: "license", apply_at: "publish_admission" },
      ],
    }),
  ]);
  assert.deepEqual(errors, []);
  const policy = policies.get("//projects/deployments/sample-webapp/shared:dev_release");
  assert.deepEqual(policy?.attestation?.trustedBuilderIdentities, ["builder:trusted"]);
  assert.equal(policy?.attestation?.signatureRequired, true);
  assert.deepEqual(policy?.sbom, { required: true, acceptedFormats: ["cyclonedx-json"] });
  assert.deepEqual(policy?.supplyChainGates, [
    { name: "vuln/critical", category: "vulnerability", applyAt: "build_admission" },
    { name: "license/allowlist", category: "license", applyAt: "publish_admission" },
  ]);
});

test("admission fails closed for missing or untrusted supply-chain evidence", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      attestation: {
        trustedBuilderIdentities: ["builder:trusted"],
        acceptedProvenanceFormats: ["slsa_provenance_v1"],
        artifactBinding: "source_revision_and_build_inputs",
        expiredBehavior: "fail_closed",
        revokedBehavior: "fail_closed",
        trustDriftBehavior: "fail_closed",
        signatureRequired: true,
        trustedSignerIdentities: ["signer:trusted"],
      },
      sbom: { required: true, acceptedFormats: ["cyclonedx-json"] },
      supplyChainGates: [
        { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
      ],
    },
  });
  const admittedContext = admittedContextFixture(deployment);
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
      }),
    }),
    /requires artifact attestation evidence/,
  );
  const untrusted = deploymentAdmissionEvidenceFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    buildInputsFingerprint: "sha256:build-inputs",
    builderIdentity: "builder:untrusted",
    supplyChainGates: [
      { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
    ],
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: untrusted,
      }),
    }),
    /builder is untrusted/,
  );
  const invalidSbom = deploymentAdmissionEvidenceFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    buildInputsFingerprint: "sha256:build-inputs",
    sbomStatus: "invalid",
    supplyChainGates: [
      { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
    ],
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: invalidSbom,
      }),
    }),
    /SBOM material is invalid/,
  );
});

test("supply-chain timing semantics distinguish build and publish admission gates", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      attestation: {
        trustedBuilderIdentities: ["builder:trusted"],
        acceptedProvenanceFormats: ["slsa_provenance_v1"],
        artifactBinding: "source_revision_and_build_inputs",
        expiredBehavior: "fail_closed",
        revokedBehavior: "fail_closed",
        trustDriftBehavior: "fail_closed",
        signatureRequired: false,
        trustedSignerIdentities: [],
      },
      supplyChainGates: [
        { name: "vuln/critical", category: "vulnerability", applyAt: "build_admission" },
        { name: "license/allowlist", category: "license", applyAt: "publish_admission" },
      ],
    },
  });
  const admittedContext = admittedContextFixture(deployment);
  const binding = admissionBindingFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    buildInputsFingerprint: "sha256:build-inputs",
  });
  const sourceRecord = {
    deployRunId: "deploy-parent",
    deploymentId: deployment.deploymentId,
    artifact: { identity: admittedContext.source.artifactIdentity },
    admittedContext: {
      source: { sourceRevision: admittedContext.source.sourceRevision },
      policyEvaluation: {
        evaluatedAt: "2026-04-06T12:00:00.000Z",
        requestedBy: { principalId: "user:submitter" },
        binding,
        requiredChecks: [],
        requiredApprovals: [],
        prerequisites: [],
        supplyChainGates: [
          {
            name: "vuln/critical",
            category: "vulnerability" as const,
            applyAt: "build_admission" as const,
            evaluatedAt: "2026-04-06T12:01:00.000Z",
            recordRef: "gate://vuln/build",
          },
        ],
      },
    },
  };
  const evaluation = await evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment,
      operationKind: "deploy",
      admittedContext,
      sourceRecord,
      evidence: deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision: admittedContext.source.sourceRevision,
        artifactIdentity: admittedContext.source.artifactIdentity,
        buildInputsFingerprint: "sha256:build-inputs",
        supplyChainGates: [
          { name: "license/allowlist", category: "license", applyAt: "publish_admission" },
        ],
      }),
    }),
  });
  assert.equal(evaluation.supplyChainGates.length, 2);
  await assert.rejects(
    evaluateDeploymentAdmission({
      workspaceRoot: process.cwd(),
      recordsRoot: path.join(
        process.cwd(),
        ".local",
        "deployments",
        "nixos-shared-host",
        "records",
      ),
      deployment,
      operationKind: "deploy",
      admittedContext,
      sourceRecord,
      evidence: deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision: admittedContext.source.sourceRevision,
        artifactIdentity: admittedContext.source.artifactIdentity,
        buildInputsFingerprint: "sha256:build-inputs",
      }),
    }),
    /license\/allowlist \(publish_admission\) did not pass/,
  );
});
