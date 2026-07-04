#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import { appNode } from "./deployment-contexts.scope.helpers";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture";
import {
  kubernetesAdmissionPolicyNodeFixture,
  kubernetesLanePolicyNodeFixture,
} from "./kubernetes.fixture";

test("resource inventory covers remaining provider extractors", () => {
  for (const [provider, nodes] of [
    ["nixos-shared-host", nixosNodes()],
    ["cloudflare-containers", cloudflareContainersNodes()],
    ["kubernetes", kubernetesNodes()],
    ["opentofu", openTofuNodes()],
  ] as const) {
    const inventory = createDeploymentResourceInventory(nodes);
    assert.deepEqual(inventory.errors, [], provider);
    const target = inventory.resources.find(
      (resource) => resource.kind === "ProviderTarget" && resource.facts?.provider === provider,
    );
    assert.ok(target, `${provider} provider target missing`);
    assertProviderCapabilityBinding(target, provider);
  }
});

function assertProviderCapabilityBinding(
  target: ReturnType<typeof createDeploymentResourceInventory>["resources"][number],
  provider: string,
) {
  assert.ok(target.refs?.includes(`provider-capability:${provider}`), provider);
  assert.equal(target.facts?.providerCapabilityId, `provider-capability:${provider}`);
  assert.equal(
    target.facts?.providerCapabilitySource,
    `build-tools/tools/deployments/provider-capabilities/${provider}.ts`,
  );
  assert.equal(target.facts?.authorityBoundary, "reviewed-provider-capability-registry");
  assert.equal((target.facts?.referenceRules as any)?.registryKey, provider);
  assert.ok((target.facts?.canonicalTargetIdentityFields as unknown[]).length > 0);
  assert.ok((target.facts?.publisherTypes as unknown[]).length > 0);
}

function basePolicyNodes() {
  return [
    nixosSharedHostLaneGovernanceNodeFixture({
      source_ref_policies: [
        { stage: "dev", allowed_refs: "main", required_checks: "deploy/sample-webapp-dev" },
        { stage: "staging", allowed_refs: "main", required_checks: "deploy/sample-webapp-staging" },
        {
          stage: "prod",
          allowed_refs: "refs/tags/release/fixture",
          required_checks: "deploy/shared-observability-prod",
        },
      ],
    }),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture({
      name: "//projects/deployments/sample-webapp/shared:dev_release",
    }),
    nixosSharedHostAdmissionPolicyNodeFixture({
      name: "//projects/deployments/sample-webapp/shared:staging_release",
      allowed_refs: ["main"],
      required_checks: ["deploy/sample-webapp-staging"],
    }),
  ];
}

function nixosNodes(): GraphNode[] {
  return [
    ...basePolicyNodes(),
    appNode({ name: "//projects/apps/demoapp:app", labels: ["kind:app", "webapp:static"] }),
    {
      name: "//projects/deployments/demoapp-dev:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/demoapp:app",
      component_kind: "static-webapp",
      app_name: "demoapp",
      container_port: "3000",
      target_group: "default",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/sample-webapp/shared:lane",
      environment_stage: "dev",
      admission_policy: "//projects/deployments/sample-webapp/shared:dev_release",
      secret_requirements: [],
      runtime_config_requirements: [],
    },
  ];
}

function cloudflareContainersNodes(): GraphNode[] {
  return [
    ...basePolicyNodes(),
    appNode({ name: "//projects/apps/api:service_artifact", labels: ["kind:app", "kind:service"] }),
    {
      name: "//projects/deployments/api-staging:deploy",
      provider: "cloudflare-containers",
      component: "//projects/apps/api:service_artifact",
      component_kind: "service",
      publisher: "cloudflare-containers-local",
      publisher_config: "wrangler.jsonc",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/sample-webapp/shared:lane",
      environment_stage: "staging",
      admission_policy: "//projects/deployments/sample-webapp/shared:staging_release",
      provider_target: {
        account_id: "0123456789abcdef0123456789abcdef",
        worker: "api-staging",
        ingress_mode: "public",
        domain: "api.example.com",
        cloudflare_zone_id: "0123456789abcdef0123456789abcdef",
        container_port: "8080",
        health_path: "/healthz",
      },
    },
  ];
}

function kubernetesNodes(): GraphNode[] {
  return [
    nixosSharedHostLaneGovernanceNodeFixture({
      source_ref_policies: [
        { stage: "dev", allowed_refs: "main", required_checks: "deploy/sample-webapp-dev" },
        { stage: "staging", allowed_refs: "main", required_checks: "deploy/sample-webapp-staging" },
        {
          stage: "prod",
          allowed_refs: "refs/tags/release/fixture",
          required_checks: "deploy/shared-observability-prod",
        },
      ],
    }),
    kubernetesLanePolicyNodeFixture(),
    kubernetesAdmissionPolicyNodeFixture(),
    appNode({ name: "//projects/apps/api:image", labels: ["kind:app", "kind:service"] }),
    {
      name: "//projects/deployments/shared-observability-prod:deploy",
      provider: "kubernetes",
      component: "//projects/apps/api:image",
      component_kind: "service",
      publisher: "helm-release",
      publisher_config: "helm/values.yaml",
      protection_class: "production_facing",
      lane_policy: "//projects/deployments/sample-webapp/shared:lane",
      environment_stage: "prod",
      admission_policy: "//projects/deployments/sample-webapp/shared:prod_release",
      provider_target: {
        cluster: "prod-us-west",
        namespace: "shared-observability",
        release: "shared-observability",
      },
    },
  ];
}

function openTofuNodes(): GraphNode[] {
  return [
    ...basePolicyNodes(),
    {
      name: "//projects/deployments/platform-foundation-dev:migration_bundle",
      labels: ["kind:migration-bundle"],
    },
    {
      name: "//projects/deployments/platform-foundation-dev:deploy",
      provider: "opentofu",
      component: "//projects/deployments/platform-foundation-dev:migration_bundle",
      component_kind: "provision-only",
      migration_bundle: "//projects/deployments/platform-foundation-dev:migration_bundle",
      publisher: "provision-only",
      provisioner: "opentofu-stack",
      provisioner_config: "opentofu/stack.json",
      protection_class: "local_only",
      lane_policy: "//projects/deployments/sample-webapp/shared:lane",
      environment_stage: "dev",
      admission_policy: "//projects/deployments/sample-webapp/shared:dev_release",
      provider_target: {
        stack_identity: "platform-foundation/dev",
        state_backend_identity: "s3://state/dev/platform-foundation",
      },
    },
  ];
}
