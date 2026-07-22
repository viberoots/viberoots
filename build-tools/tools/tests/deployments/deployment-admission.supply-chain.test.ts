#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { extractDeploymentAdmissionPolicies } from "../../deployments/deployment-policy";
import {
  admissionBindingFixture,
  deploymentAdmissionEvidenceFixture,
  protectedAggregateFixture,
  protectedArtifactIdentityDigest,
} from "./deployment-admission.fixture";
import {
  admissionEvalBase,
  admittedContextFixture,
  deploymentRecordsRoot,
} from "./deployment-admission.test-helpers";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";

test("admission policy extraction preserves attestation, SBOM, and supply-chain policy fields", () => {
  const { policies, errors } = extractDeploymentAdmissionPolicies([
    nixosSharedHostAdmissionPolicyNodeFixture({
      trusted_builder_identities: ["reviewed:builder-trusted"],
      accepted_provenance_formats: ["viberoots.hermetic-artifact.v1"],
      artifact_binding: "source_revision_and_build_inputs",
      expired_attestation_behavior: "fail_closed",
      revoked_attestation_behavior: "fail_closed",
      attestation_trust_drift_behavior: "fail_closed",
      require_artifact_signatures: true,
      trusted_signer_identities: ["nix:main"],
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
  assert.deepEqual(policy?.attestation?.trustedBuilderIdentities, ["reviewed:builder-trusted"]);
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
        trustedBuilderIdentities: [],
        acceptedProvenanceFormats: ["viberoots.hermetic-artifact.v1"],
        artifactBinding: "source_revision_and_build_inputs",
        expiredBehavior: "fail_closed",
        revokedBehavior: "fail_closed",
        trustDriftBehavior: "fail_closed",
        signatureRequired: true,
        trustedSignerIdentities: ["nix:main"],
      },
      sbom: { required: true, acceptedFormats: ["cyclonedx-json"] },
      supplyChainGates: [
        { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
      ],
    },
  });
  const admittedContext = admittedContextFixture(deployment, { sourceRevision: "a".repeat(40) });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
      }),
    }),
    /requires exactly one publication attestation selection/,
  );
  const staticBuilderDeployment = {
    ...deployment,
    admissionPolicy: {
      ...deployment.admissionPolicy,
      attestation: {
        ...deployment.admissionPolicy.attestation!,
        trustedBuilderIdentities: ["reviewed:only-this-builder"],
      },
    },
  };
  const untrusted = deploymentAdmissionEvidenceFixture({
    deployment: staticBuilderDeployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    buildInputsFingerprint: protectedArtifactIdentityDigest,
    supplyChainGates: [
      { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
    ],
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment: staticBuilderDeployment,
        operationKind: "deploy",
        admittedContext,
        evidence: untrusted,
        protectedAggregateReader: async () =>
          protectedAggregateFixture({
            sourceRevision: admittedContext.source.sourceRevision,
            artifactIdentity: admittedContext.source.artifactIdentity!,
          }),
      }),
    }),
    /untrusted builder/,
  );
  const invalidSbom = deploymentAdmissionEvidenceFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    buildInputsFingerprint: protectedArtifactIdentityDigest,
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
        protectedAggregateReader: async () =>
          protectedAggregateFixture({
            sourceRevision: admittedContext.source.sourceRevision,
            artifactIdentity: admittedContext.source.artifactIdentity!,
          }),
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
        trustedBuilderIdentities: [],
        acceptedProvenanceFormats: ["viberoots.hermetic-artifact.v1"],
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
  const admittedContext = admittedContextFixture(deployment, { sourceRevision: "a".repeat(40) });
  const binding = admissionBindingFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    buildInputsFingerprint: protectedArtifactIdentityDigest,
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
        buildInputsFingerprint: protectedArtifactIdentityDigest,
        supplyChainGates: [
          { name: "license/allowlist", category: "license", applyAt: "publish_admission" },
        ],
      }),
      protectedAggregateReader: async () =>
        protectedAggregateFixture({
          sourceRevision: admittedContext.source.sourceRevision,
          artifactIdentity: admittedContext.source.artifactIdentity!,
        }),
    }),
  });
  assert.equal(evaluation.supplyChainGates.length, 2);
  await assert.rejects(
    evaluateDeploymentAdmission({
      workspaceRoot: process.cwd(),
      recordsRoot: deploymentRecordsRoot(process.cwd(), "nixos-shared-host"),
      deployment,
      operationKind: "deploy",
      admittedContext,
      sourceRecord,
      evidence: deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision: admittedContext.source.sourceRevision,
        artifactIdentity: admittedContext.source.artifactIdentity,
        buildInputsFingerprint: protectedArtifactIdentityDigest,
      }),
      protectedAggregateReader: async () =>
        protectedAggregateFixture({
          sourceRevision: admittedContext.source.sourceRevision,
          artifactIdentity: admittedContext.source.artifactIdentity!,
        }),
      protectedPublicationOutputEnsurer: async () => {},
      staticWebappIdentityForOutput: async () => admittedContext.source.artifactIdentity!,
    }),
    /license\/allowlist \(publish_admission\) did not pass/,
  );
});
