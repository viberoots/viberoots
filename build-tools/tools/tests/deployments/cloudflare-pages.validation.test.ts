#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractCloudflarePagesDeployments } from "../../deployments/contract.ts";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture.ts";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:pwa"],
  };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
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
      id: "pleomino-staging-pages",
    },
    ...overrides,
  };
}

function policyNodes(): GraphNode[] {
  return [cloudflarePagesLanePolicyNodeFixture(), cloudflarePagesAdmissionPolicyNodeFixture()];
}

test("validation rejects duplicate cloudflare provider target identity collisions", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/pleomino:app"),
    staticWebappComponent("//projects/apps/other:app"),
    ...policyNodes(),
    deploymentNode(),
    deploymentNode({
      name: "//projects/deployments/other-staging:deploy",
      component: "//projects/apps/other:app",
    }),
  ];
  const { errors } = extractCloudflarePagesDeployments(nodes);
  assert.ok(errors.some((entry) => entry.includes("duplicate provider_target identity")));
});

test("validation rejects missing publisher_config", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({ publisher_config: "" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("missing required publisher_config")));
});

test("validation rejects unsupported cloudflare publisher", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({ publisher: "other-publisher" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported cloudflare-pages publisher")));
});

test("validation rejects unsupported protection_class for cloudflare-pages", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({ protection_class: "local_only" }),
  ]);
  assert.ok(
    errors.some((entry) =>
      entry.includes('must use protection_class "shared_nonprod" or "production_facing"'),
    ),
  );
});
