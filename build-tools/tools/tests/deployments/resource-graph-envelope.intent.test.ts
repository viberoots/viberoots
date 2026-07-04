#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectDeploymentIntentResources } from "../../deployments/resource-graph-collectors";
import { createDeploymentResourceEnvelopes } from "../../deployments/resource-graph-envelope";
import type { DeploymentResourceInventory } from "../../deployments/resource-graph-types";
import {
  deploymentReleaseActionFixture,
  deploymentTargetExceptionFixture,
} from "./deployment-metadata.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";

test("intent envelopes cover every extractable kind from deployment contracts", () => {
  const releaseAction = deploymentReleaseActionFixture();
  const targetException = deploymentTargetExceptionFixture({
    affectedDeploymentIds: ["sample-webapp"],
  });
  const deployment = s3StaticDeploymentFixture({
    deploymentId: "sample-webapp",
    provisioner: { type: "terraform-stack" },
    releaseActions: [releaseAction],
    targetExceptions: [targetException],
    secretRequirements: [
      {
        name: "database_url",
        step: "release_actions.pre_publish",
        contractId: "secret://deployments/sample-webapp/database-url",
        required: true,
      },
    ],
    runtimeConfigRequirements: [
      {
        name: "schema_version",
        step: "release_actions.pre_publish",
        contractId: "runtime://deployments/sample-webapp/schema-version",
        required: true,
      },
    ],
    rolloutPolicy: {
      mode: "phased",
      abort: "stop_on_first_failure",
      smoke: "both",
      steps: ["dev", "staging", "prod"],
    },
    smoke: { runner: "curl", url: "https://sample-webapp.example", expectedStatus: "200" },
  });
  deployment.deploymentFamily = "sample-webapp-family";
  deployment.preview = {
    targetDerivation: "preview",
    isolationClass: "branch",
    identitySelector: "branch",
    cleanupTtl: "7d",
    smokeTarget: "preview_url",
    lockScope: "preview",
  };
  deployment.admissionPolicy = {
    ...deployment.admissionPolicy,
    readinessGates: [{ name: "database", type: "mcp", requiredFor: ["deploy"], gateVersion: "v1" }],
    attestation: {
      trustedBuilderIdentities: ["builder://ci"],
      acceptedProvenanceFormats: ["slsa"],
      artifactBinding: "source_revision_and_build_inputs",
      expiredBehavior: "fail_closed",
      revokedBehavior: "fail_closed",
      trustDriftBehavior: "fail_closed",
      signatureRequired: true,
      trustedSignerIdentities: ["signer://release"],
    },
    sbom: { required: true, acceptedFormats: ["spdx-json"] },
    supplyChainGates: [{ name: "vuln-scan", category: "vulnerability", applyAt: "both" }],
  };
  const envelopes = createDeploymentResourceEnvelopes(
    inventory(collectDeploymentIntentResources(deployment)),
  );
  assert.deepEqual(envelopes.errors, []);
  for (const kind of extractableKinds()) {
    const found = envelopes.envelopes.find((item) => item.kind === kind);
    assert.ok(found, `${kind} envelope missing`);
    assert.equal(found.apiVersion, "deployment.resource.viberoots.dev/v1");
    assert.match(found.metadata.uid, new RegExp(`^uid:deployment-resource:${kind}:`));
    assert.equal(found.statusRef, `status:${found.metadata.uid}`);
    assert.equal(found.metadata.labels["viberoots.dev/authority"], "reviewed_intent");
    assert.equal(found.source.class, "buck");
  }
  assert.equal(
    envelope(envelopes, "SecretRequirement").spec.contractId,
    "secret://deployments/sample-webapp/database-url",
  );
  assert.equal(
    envelope(envelopes, "RuntimeConfigRequirement").spec.contractId,
    "runtime://deployments/sample-webapp/schema-version",
  );
});

function extractableKinds() {
  return [
    "Deployment",
    "DeploymentFamily",
    "Component",
    "ProviderTarget",
    "EnvironmentStage",
    "LanePolicy",
    "LaneGovernancePolicy",
    "AdmissionPolicy",
    "RolloutPolicy",
    "PreviewPolicy",
    "SmokePolicy",
    "SourceRefPolicy",
    "ReadinessGatePolicy",
    "AttestationPolicy",
    "SbomPolicy",
    "SupplyChainPolicy",
    "SecretRequirement",
    "RuntimeConfigRequirement",
    "DeploymentTargetException",
    "Provisioner",
    "ReleaseAction",
    "ArtifactInput",
  ] as const;
}

function envelope(result: ReturnType<typeof createDeploymentResourceEnvelopes>, kind: string) {
  const found = result.envelopes.find((item) => item.kind === kind);
  assert.ok(found, `${kind} envelope missing`);
  return found;
}

function inventory(
  resources: DeploymentResourceInventory["resources"],
): DeploymentResourceInventory {
  return {
    taxonomyVersion: "deployment-resource-taxonomy@1",
    resources,
    errors: [],
    graphRead: { providerIndexAvailable: false, nodeLockIndexAvailable: false },
    workspace: {
      supportedDeploymentQueryRoots: [],
      projectConfig: {
        sharedPath: "projects/config/shared.json",
        localPath: "projects/config/local.json",
        localPresent: false,
        disallowLocalOverrides: false,
        redactedOverrides: [],
      },
    },
  };
}
