import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAttestationPolicy } from "../../deployments/deployment-admission-supply-chain-evaluator";
import { normalizeAttestationEvidence } from "../../deployments/deployment-admission-supply-chain";
import {
  admissionBindingFixture,
  protectedAggregateFixture,
  protectedArtifactIdentityDigest,
} from "./deployment-admission.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

const revision = "a".repeat(40);
const output = `/nix/store/${"b".repeat(32)}-static-webapp`;
const artifactIdentity = `static-webapp:${"e".repeat(64)}`;
const aggregateFile = `/nix/store/${"a".repeat(32)}-aggregate/aggregate.json`;
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
  },
});
const binding = admissionBindingFixture({
  deployment,
  operationKind: "deploy",
  sourceRevision: revision,
  artifactIdentity,
  buildInputsFingerprint: protectedArtifactIdentityDigest,
});
const admittedContext = { source: { sourceRevision: revision, artifactIdentity } };
const evidence = {
  reproducibilityAggregateStorePath: aggregateFile,
  publicationOutputPath: output,
  evidenceStoreLocator: "s3://reviewed-evidence/reproducibility",
};

test("protected hermetic deployment admits the verified signed aggregate", async () => {
  const fact = await evaluateAttestationPolicy({
    deployment,
    policy: deployment.admissionPolicy,
    binding,
    admittedContext,
    evidence: [evidence],
    protectedAggregateReader: async () =>
      protectedAggregateFixture({
        sourceRevision: revision,
        artifactIdentity,
        publicationOutputPath: output,
      }),
    protectedPublicationOutputEnsurer: async () => {},
    staticWebappIdentityForOutput: async () => artifactIdentity,
  });
  assert.equal(fact?.reproducibilityAggregateStorePath, aggregateFile);
  assert.equal(fact?.signatureStatus, "verified");
  assert.deepEqual(fact?.signerIdentities, ["nix:main"]);
  assert.equal(fact?.builderIdentities.length, 2);
});

test("protected hermetic deployment rejects unsigned or mismatched aggregates", async () => {
  await assert.rejects(
    evaluateAttestationPolicy({
      deployment,
      policy: deployment.admissionPolicy,
      binding,
      admittedContext,
      evidence: [evidence],
    }),
    /verified signed reproducibility aggregate/,
  );
  await assert.rejects(
    evaluateAttestationPolicy({
      deployment,
      policy: deployment.admissionPolicy,
      binding,
      admittedContext,
      evidence: [evidence],
      protectedAggregateReader: async () =>
        protectedAggregateFixture({
          sourceRevision: "c".repeat(40),
          artifactIdentity,
          publicationOutputPath: output,
        }),
      protectedPublicationOutputEnsurer: async () => {},
      staticWebappIdentityForOutput: async () => artifactIdentity,
    }),
    /does not bind to the admitted source revision and build inputs/,
  );
});

test("caller-authored comparison, signature, and positive status claims are rejected", () => {
  assert.deepEqual(
    normalizeAttestationEvidence([
      {
        ...evidence,
        signatureStatus: "verified",
        signerIdentities: ["nix:main"],
        hermeticRecord: {},
        status: "verified",
        verifiedAt: "2026-07-21T00:00:00.000Z",
      },
    ]),
    [],
  );
});
