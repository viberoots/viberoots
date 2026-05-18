#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
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
    provider_target: { account: "staging", project: "pleomino-staging-pages" },
    ...overrides,
  };
}

function extract(overrides: Partial<GraphNode> = {}) {
  return extractCloudflarePagesDeployments([
    { name: "//projects/apps/pleomino:app", labels: ["kind:app", "webapp:pwa"] },
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    deploymentNode(overrides),
  ]);
}

test("unified secret backend selectors normalize to backend-prefixed profiles", () => {
  for (const [secretBackend, backend, profile] of [
    ["vault/default", "vault", "vault-default"],
    ["infisical/default", "infisical", "infisical-default"],
    ["infisical/regulated", "infisical", "infisical-regulated"],
  ] as const) {
    const result = extract({ secret_backend: secretBackend });
    assert.deepEqual(result.errors, []);
    assert.equal(result.deployments[0]?.secretBackend, backend);
    assert.equal(result.deployments[0]?.secretBackendProfile, profile);
  }
});

test("secret backend selector validation rejects malformed or split-form metadata", () => {
  for (const [overrides, expected] of [
    [{ secret_backend: "infisical/" }, "secret_backend must use"],
    [{ secret_backend: "other/default" }, 'unsupported secret_backend backend "other"'],
    [{ secret_backend: "infisical/infisical-regulated" }, "backend-local kebab-case"],
    [{ secret_backend: "vault" }, "secret_backend must use"],
    [{ secret_backend: "infisical" }, "secret_backend must use"],
    [
      { secret_backend: "infisical/default", secret_backend_profile: "infisical-default" },
      "secret_backend_profile is unsupported",
    ],
  ] as const) {
    const errors = extract(overrides).errors;
    assert.ok(
      errors.some((entry) => entry.includes(expected)),
      expected,
    );
  }
});
