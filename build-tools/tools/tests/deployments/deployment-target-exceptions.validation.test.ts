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
import { deploymentTargetExceptionNodeFixture } from "./deployment-metadata.fixture";

function staticWebappComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app", "webapp:pwa"] };
}

function deploymentNode(name: string, component: string, deploymentId: string): GraphNode {
  return {
    name,
    provider: "cloudflare-pages",
    component,
    component_kind: "static-webapp",
    publisher: "wrangler-pages",
    publisher_config: "wrangler.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/sample-webapp/shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/sample-webapp/shared:staging_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    target_exceptions: ["//projects/deployments/demoapp-shared:alias_window"],
    provider_target: {
      account: "web-platform-staging",
      project: "demoapp-pages",
      id: "demoapp-pages",
    },
    deployment_id: deploymentId,
  };
}

test("validation allows reviewed alias windows for shared cloudflare target identity transitions", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    staticWebappComponent("//projects/apps/demoapp-next:app"),
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    deploymentTargetExceptionNodeFixture({
      affected_deployments: ["demoapp-staging", "demoapp-next-staging"],
      old_provider_target_identity: "cloudflare-pages:web-platform-staging/demoapp-pages",
      shared_lock_scope: "cloudflare-pages:web-platform-staging/demoapp-pages",
    }),
    deploymentNode(
      "//projects/deployments/demoapp-staging:deploy",
      "//projects/apps/demoapp:app",
      "demoapp-staging",
    ),
    deploymentNode(
      "//projects/deployments/demoapp-next-staging:deploy",
      "//projects/apps/demoapp-next:app",
      "demoapp-next-staging",
    ),
  ];
  const { errors, deployments } = extractCloudflarePagesDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 2);
});
