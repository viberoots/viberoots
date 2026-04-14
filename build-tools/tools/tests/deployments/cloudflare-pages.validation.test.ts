#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractCloudflarePagesDeployments } from "../../deployments/contract.ts";
import { REVIEWED_NON_STATIC_COMPONENT_KINDS } from "../../deployments/deployment-provider-capabilities.ts";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
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
    name: "//test-workspace/deployments/pleomino-staging:deploy",
    provider: "cloudflare-pages",
    component: "//test-workspace/apps/pleomino:app",
    component_kind: "static-webapp",
    publisher: "wrangler-pages",
    publisher_config: "wrangler.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//test-workspace/deployments/pleomino-shared:lane",
    environment_stage: "staging",
    admission_policy: "//test-workspace/deployments/pleomino-shared:staging_release",
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

function policyNodes(): GraphNode[] {
  return [
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
  ];
}

test("validation rejects duplicate cloudflare provider target identity collisions", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//test-workspace/apps/pleomino:app"),
    staticWebappComponent("//test-workspace/apps/other:app"),
    ...policyNodes(),
    deploymentNode(),
    deploymentNode({
      name: "//test-workspace/deployments/other-staging:deploy",
      component: "//test-workspace/apps/other:app",
    }),
  ];
  const { errors } = extractCloudflarePagesDeployments(nodes);
  assert.ok(errors.some((entry) => entry.includes("duplicate provider_target identity")));
});

test("validation rejects missing publisher_config", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//test-workspace/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({ publisher_config: "" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("missing required publisher_config")));
});

test("validation rejects unsupported cloudflare publisher", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//test-workspace/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({ publisher: "other-publisher" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported cloudflare-pages publisher")));
});

test("validation rejects unsupported protection_class for cloudflare-pages", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//test-workspace/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({ protection_class: "local_only" }),
  ]);
  assert.ok(
    errors.some((entry) =>
      entry.includes('must use protection_class "shared_nonprod" or "production_facing"'),
    ),
  );
});

test("validation rejects preview metadata that reuses the normal live target", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//test-workspace/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({
      preview: {
        target_derivation: "live_target",
        isolation_class: "isolated",
        identity_selector: "source_run",
        smoke_target: "preview_url",
        lock_scope: "shared",
      },
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("must not reuse the normal live target")));
});

test("validation rejects cloudflare preview metadata that does not use source-run identity", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//test-workspace/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({
      preview: {
        target_derivation: "provider_managed_source_run",
        isolation_class: "isolated",
        identity_selector: "branch",
        smoke_target: "preview_url",
        lock_scope: "shared",
      },
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes('identity_selector must be "source_run"')));
});

test("validation rejects multi-component cloudflare-pages deployments", () => {
  const { errors } = extractCloudflarePagesDeployments([
    staticWebappComponent("//test-workspace/apps/pleomino:app"),
    staticWebappComponent("//test-workspace/apps/other:app"),
    ...policyNodes(),
    deploymentNode({
      components: [
        { id: "primary", kind: "static-webapp", target: "//test-workspace/apps/pleomino:app" },
        { id: "secondary", kind: "static-webapp", target: "//test-workspace/apps/other:app" },
      ],
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("does not support multi-component")));
});

test("validation rejects reviewed non-static kinds until cloudflare-pages declares capability support", () => {
  for (const kind of REVIEWED_NON_STATIC_COMPONENT_KINDS) {
    const { errors } = extractCloudflarePagesDeployments([
      { name: "//test-workspace/apps/pleomino:app", labels: ["kind:app", "webapp:ssr"] },
      ...policyNodes(),
      deploymentNode({ component_kind: kind }),
    ]);
    assert.ok(
      errors.some((entry) => entry.includes(`does not support component_kind "${kind}"`)),
      `expected cloudflare-pages to reject ${kind}, saw: ${errors.join("\n")}`,
    );
  }
});
