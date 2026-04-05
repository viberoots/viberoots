#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import {
  deriveCloudflarePagesProviderTarget,
  extractCloudflarePagesDeployments,
} from "../../deployments/contract.ts";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture.ts";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:static"],
  };
}

test("deriveCloudflarePagesProviderTarget normalizes canonical url and lock identity", () => {
  const target = deriveCloudflarePagesProviderTarget({
    account: "web-platform-staging",
    project: "pleomino-staging-pages",
  });
  assert.deepEqual(target, {
    account: "web-platform-staging",
    project: "pleomino-staging-pages",
    id: "pleomino-staging-pages",
    canonicalUrl: "https://pleomino-staging-pages.pages.dev/",
    providerTargetIdentity: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  });
});

test("extractCloudflarePagesDeployments reads provider target and publisher config", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/pleomino:app"),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
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
    },
  ];

  const { deployments, errors } = extractCloudflarePagesDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.publisher.config, "wrangler.jsonc");
  assert.equal(deployments[0]?.providerTarget.id, "pleomino-staging-pages");
  assert.equal(
    deployments[0]?.providerTarget.providerTargetIdentity,
    "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  );
});
