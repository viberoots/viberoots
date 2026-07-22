#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import {
  deploymentAdmissionEvidenceFixture,
  protectedAggregateFixture,
  protectedArtifactIdentityDigest,
} from "./deployment-admission.fixture";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("replayed supply-chain evidence reverifies its signed aggregate", async () => {
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
  const admittedContext = admittedContextFixture(deployment, { sourceRevision: "a".repeat(40) });
  const evidence = deploymentAdmissionEvidenceFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    buildInputsFingerprint: protectedArtifactIdentityDigest,
  });
  let verifications = 0;
  const protectedAggregateReader = async () => {
    verifications += 1;
    return protectedAggregateFixture({
      sourceRevision: admittedContext.source.sourceRevision,
      artifactIdentity: admittedContext.source.artifactIdentity!,
    });
  };
  const evaluate = async () =>
    await evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence,
        protectedAggregateReader,
      }),
    });

  const initial = await evaluate();
  const replay = await evaluate();
  assert.equal(
    initial.attestation?.reproducibilityAggregateStorePath,
    replay.attestation?.reproducibilityAggregateStorePath,
  );
  assert.equal(verifications, 2);
});
