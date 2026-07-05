#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentResourceEnvelopes } from "../../deployments/resource-graph-envelope";
import { createDeploymentResourceGraphDocuments } from "../../deployments/resource-graph-export";
import { collectDeploymentIntentResources } from "../../deployments/resource-graph-collectors";
import { deploymentReleaseActionFixture } from "./deployment-metadata.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("resource envelopes expose first-class provider and release-action policies", () => {
  const releaseAction = deploymentReleaseActionFixture({
    type: "cache_warmup",
    fingerprint: "sha256:release-action-cache-warmup",
  });
  const deployment = nixosSharedHostDeploymentFixture({ releaseActions: [releaseAction] });
  const result = createDeploymentResourceEnvelopes({
    taxonomyVersion: "deployment-resource-taxonomy@1",
    errors: [],
    graphRead: { providerIndexAvailable: false, nodeLockIndexAvailable: false },
    workspace: { supportedDeploymentQueryRoots: [], projectConfig: projectConfig() },
    resources: collectDeploymentIntentResources(deployment),
  });
  assert.deepEqual(result.errors, []);
  const providerPolicy = envelope(result.envelopes, "ProviderCapabilityPolicy");
  const releasePolicy = envelope(result.envelopes, "ReleaseActionPolicy");
  assert.equal(providerPolicy.spec.policyResourceVersion, "provider-capability@1");
  assert.equal(releasePolicy.spec.policyResourceVersion, "sha256:release-action-cache-warmup");
  assert.equal(
    releasePolicy.policyRefs.includes(releasePolicy.metadata.uid),
    false,
    "release action policy must not point at itself",
  );
  assert.equal(
    result.envelopes
      .find((item) => item.kind === "Deployment")
      ?.policyRefs.includes(releasePolicy.metadata.uid),
    true,
  );
});

test("resource graph node status carries policy refs for operator read models", () => {
  const deployment = nixosSharedHostDeploymentFixture();
  const envelopes = createDeploymentResourceEnvelopes({
    taxonomyVersion: "deployment-resource-taxonomy@1",
    errors: [],
    graphRead: { providerIndexAvailable: false, nodeLockIndexAvailable: false },
    workspace: { supportedDeploymentQueryRoots: [], projectConfig: projectConfig() },
    resources: collectDeploymentIntentResources(deployment),
  });
  const documents = createDeploymentResourceGraphDocuments(envelopes);
  const node = documents.nodes.nodes.find((entry) => entry.kind === "Deployment") as any;
  assert.equal(node.facts.policyResourceRefs[0].resourceId.length > 0, true);
  assert.equal(node.facts.policyResourceRefs[0].version.length > 0, true);
});

test("resource graph carries rollout preview and smoke policy resource versions", () => {
  const deployment = {
    ...nixosSharedHostDeploymentFixture({
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
  const result = createDeploymentResourceEnvelopes({
    taxonomyVersion: "deployment-resource-taxonomy@1",
    errors: [],
    graphRead: { providerIndexAvailable: false, nodeLockIndexAvailable: false },
    workspace: { supportedDeploymentQueryRoots: [], projectConfig: projectConfig() },
    resources: collectDeploymentIntentResources(deployment),
  });
  assert.deepEqual(result.errors, []);
  for (const kind of ["RolloutPolicy", "PreviewPolicy", "SmokePolicy"]) {
    const policy = envelope(result.envelopes, kind);
    assert.equal(typeof policy.spec.policyResourceVersion, "string");
    assert.equal(policy.spec.policyResourceVersion.startsWith("sha256:"), true);
  }
});

function envelope(envelopes: any[], kind: string) {
  const found = envelopes.find((item) => item.kind === kind);
  assert.ok(found, `${kind} envelope should exist`);
  return found;
}

function projectConfig() {
  return {
    sharedPath: "projects/config/shared.json",
    localPath: "projects/config/local.json",
    localPresent: false,
    disallowLocalOverrides: false,
    redactedOverrides: [],
  };
}
