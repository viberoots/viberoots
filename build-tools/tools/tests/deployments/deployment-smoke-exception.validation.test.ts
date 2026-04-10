#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import {
  extractCloudflarePagesDeployments,
  extractNixosSharedHostDeployments,
} from "../../deployments/contract.ts";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture.ts";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";

function staticWebappComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app", "webapp:pwa"] };
}

function cloudflareNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/pleomino-staging:deploy",
    provider: "cloudflare-pages",
    component: "//projects/apps/pleomino:app",
    component_kind: "static-webapp",
    publisher: "wrangler-pages",
    publisher_config: "wrangler.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/pleomino-shared:staging_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {
      account: "web-platform-staging",
      project: "pleomino-staging-pages",
      id: "pleomino-staging-pages",
    },
    ...overrides,
  };
}

function nixosNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/demoapp-dev:deploy",
    provider: "nixos-shared-host",
    component: "//projects/apps/demoapp:app",
    component_kind: "static-webapp",
    publisher: "nixos-shared-host-static-webapp",
    provisioner: "nixos-shared-host-manifest",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "dev",
    admission_policy: "//projects/deployments/pleomino-shared:dev_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    app_name: "demoapp",
    container_port: 3000,
    ...overrides,
  };
}

test("validation rejects protected/shared smoke exceptions with missing reviewed fields", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    cloudflareNode({
      smoke_exception: {
        owner: "",
        reason: "",
        scope: "downgrade-to-nonblocking",
      },
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("smoke.exception.owner is required")));
  assert.ok(errors.some((entry) => entry.includes("smoke.exception.reason is required")));
  assert.ok(errors.some((entry) => entry.includes("review_by or expires_at")));
});

test("validation rejects smoke exceptions whose review boundary has expired", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    nixosNode({
      smoke_exception: {
        owner: "web-platform",
        reason: "temporary preview relaxation",
        scope: "preview-downgrade-to-nonblocking",
        review_by: "2020-01-01",
      },
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("smoke.exception.review_by is no longer valid")));
});

test("validation preserves reviewed smoke exceptions from authoritative deployment metadata", () => {
  const { deployments, errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    cloudflareNode({
      smoke_exception: {
        owner: "web-platform",
        reason: "preview DNS settles slowly",
        scope: "preview-downgrade-to-nonblocking",
        expires_at: "2099-01-01T00:00:00.000Z",
        downgrade_mode: "nonblocking-preview-http",
      },
    }),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.smoke?.exception?.scope, "preview-downgrade-to-nonblocking");
  assert.equal(deployments[0]?.smoke?.exception?.downgradeMode, "nonblocking-preview-http");
});

test("validation rejects unsupported smoke runner classes and non-positive timeout budgets", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    cloudflareNode({
      smoke_runner_class: "release_health",
      smoke_timeout_budget_ms: "0",
    }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes("release_health is reviewed only for mobile-app")),
  );
  assert.ok(
    errors.some((entry) => entry.includes("smoke.timeoutBudgetMs must be a positive integer")),
  );
});

test("validation preserves explicit smoke timeout metadata for reviewed static-webapp slices", () => {
  const { deployments, errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    cloudflareNode({
      smoke_runner_class: "http_10m",
      smoke_timeout_budget_ms: "120000",
    }),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.smoke?.runnerClass, "http_10m");
  assert.equal(deployments[0]?.smoke?.timeoutBudgetMs, 120000);
});
