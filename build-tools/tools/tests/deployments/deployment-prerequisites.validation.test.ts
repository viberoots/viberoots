#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractDeployments } from "../../deployments/contract.ts";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture.ts";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";

function staticWebappComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app", "webapp:static"] };
}

test("deployment prerequisite extraction preserves valid direct-edge metadata", () => {
  const { deployments, errors } = extractDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    {
      name: "//projects/deployments/pleomino-dev:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "shared_nonprod",
      lane_policy: "//build-tools/deployments/lanes:pleomino",
      environment_stage: "dev",
      admission_policy: "//build-tools/deployments/policies:pleomino_dev_release",
      app_name: "pleomino",
      container_port: 3000,
    },
    {
      name: "//projects/deployments/pleomino-staging:deploy",
      provider: "cloudflare-pages",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "wrangler-pages",
      publisher_config: "wrangler.jsonc",
      protection_class: "shared_nonprod",
      lane_policy: "//build-tools/deployments/lanes:pleomino",
      environment_stage: "staging",
      admission_policy: "//build-tools/deployments/policies:pleomino_staging_release",
      provider_target: {
        account: "web-platform-staging",
        project: "pleomino-staging-pages",
      },
      prerequisites: [{ deployment_id: "pleomino-dev", mode: "ordering_only" }],
    },
  ]);

  assert.deepEqual(errors, []);
  assert.deepEqual(deployments[1]?.prerequisites, [
    { deploymentId: "pleomino-dev", mode: "ordering_only" },
  ]);
});

test("deployment extraction rejects cross-lane prerequisites", () => {
  const { errors } = extractDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    nixosSharedHostLanePolicyNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture({
      name: "//build-tools/deployments/lanes:marketing",
      stages: ["staging"],
      stage_branches: { staging: "env/marketing/staging" },
      allowed_promotion_edges: [],
    }),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture({
      name: "//build-tools/deployments/policies:marketing_staging_release",
      allowed_refs: ["env/marketing/staging"],
      required_checks: ["deploy/marketing-staging"],
    }),
    {
      name: "//projects/deployments/pleomino-dev:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "shared_nonprod",
      lane_policy: "//build-tools/deployments/lanes:pleomino",
      environment_stage: "dev",
      admission_policy: "//build-tools/deployments/policies:pleomino_dev_release",
      app_name: "pleomino",
      container_port: 3000,
    },
    {
      name: "//projects/deployments/marketing-staging:deploy",
      provider: "cloudflare-pages",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "wrangler-pages",
      publisher_config: "wrangler.jsonc",
      protection_class: "shared_nonprod",
      lane_policy: "//build-tools/deployments/lanes:marketing",
      environment_stage: "staging",
      admission_policy: "//build-tools/deployments/policies:marketing_staging_release",
      provider_target: { account: "acct", project: "marketing-staging-pages" },
      prerequisites: [{ deployment_id: "pleomino-dev", mode: "ordering_only" }],
    },
  ]);

  assert.ok(errors.some((entry) => entry.includes("cross-lane prerequisite")));
});

test("deployment extraction rejects cyclic prerequisite graphs", () => {
  const { errors } = extractDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture({
      name: "//build-tools/deployments/policies:pleomino_staging_release",
      allowed_refs: ["env/pleomino/staging"],
      required_checks: ["deploy/pleomino-staging"],
    }),
    {
      name: "//projects/deployments/pleomino-dev:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "shared_nonprod",
      lane_policy: "//build-tools/deployments/lanes:pleomino",
      environment_stage: "dev",
      admission_policy: "//build-tools/deployments/policies:pleomino_dev_release",
      app_name: "pleomino-dev",
      container_port: 3000,
      prerequisites: [{ deployment_id: "pleomino-staging", mode: "ordering_only" }],
    },
    {
      name: "//projects/deployments/pleomino-staging:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "shared_nonprod",
      lane_policy: "//build-tools/deployments/lanes:pleomino",
      environment_stage: "staging",
      admission_policy: "//build-tools/deployments/policies:pleomino_staging_release",
      app_name: "pleomino-staging",
      container_port: 3001,
      prerequisites: [{ deployment_id: "pleomino-dev", mode: "ordering_only" }],
    },
  ]);

  assert.ok(errors.some((entry) => entry.includes("invalid prerequisite cycle")));
});
