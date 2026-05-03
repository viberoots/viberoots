#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import {
  deriveVercelProviderTarget,
  extractVercelDeployments,
} from "../../deployments/contract.ts";
import { vercelPolicyNodes } from "./vercel.fixture.ts";

function ssrComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app", "webapp:ssr"] };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/console-staging:deploy",
    provider: "vercel",
    component: "//projects/apps/console:app",
    component_kind: "ssr-webapp",
    publisher: "vercel-prebuilt",
    publisher_config: "vercel-prebuilt.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/pleomino-shared:staging_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {
      team: "web-platform",
      project: "console-staging",
      environment: "staging",
    },
    ...overrides,
  };
}

test("deriveVercelProviderTarget creates canonical identity and URL", () => {
  assert.deepEqual(
    deriveVercelProviderTarget({
      team: "web-platform",
      project: "console-staging",
      environment: "staging",
    }),
    {
      team: "web-platform",
      project: "console-staging",
      environment: "staging",
      canonicalUrl: "https://console-staging.vercel.app/",
      providerTargetIdentity: "vercel:web-platform/console-staging#staging",
    },
  );
});

test("extractVercelDeployments reads provider target and publisher config", () => {
  const { deployments, errors } = extractVercelDeployments([
    ssrComponent("//projects/apps/console:app"),
    ...vercelPolicyNodes(),
    deploymentNode(),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.component.kind, "ssr-webapp");
  assert.equal(deployments[0]?.publisher.type, "vercel-prebuilt");
  assert.equal(
    deployments[0]?.providerTarget.providerTargetIdentity,
    "vercel:web-platform/console-staging#staging",
  );
});
