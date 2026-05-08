#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDeployments } from "../../deployments/contract";
import type { GraphNode } from "../../lib/graph";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";
import { deploymentTargetExceptionNodeFixture } from "./deployment-metadata.fixture";

const accountId = "0123456789abcdef0123456789abcdef";
const providerTargetIdentity = `cloudflare-containers:${accountId}/api-staging`;
const workersDevExceptionRef = "//projects/deployments/pleomino-shared:api_workers_dev";

function serviceNode(): GraphNode {
  return {
    name: "//projects/apps/api:service_artifact",
    labels: ["kind:app", "kind:service"],
  };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/api-staging:deploy",
    provider: "cloudflare-containers",
    component: "//projects/apps/api:service_artifact",
    component_kind: "service",
    components: [
      {
        id: "default",
        kind: "service",
        target: "//projects/apps/api:service_artifact",
      },
    ],
    publisher: "cloudflare-containers-local",
    publisher_config: "wrangler.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/pleomino-shared:staging_release",
    provider_target: {
      account_id: accountId,
      worker: "api-staging",
      ingress_mode: "public",
      container_port: "8080",
      workers_dev_exception: "true",
    },
    ...overrides,
  };
}

function extract(nodes: GraphNode[]) {
  return extractDeployments([
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    serviceNode(),
    ...nodes,
  ]);
}

function workersDevExceptionNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return deploymentTargetExceptionNodeFixture({
    name: workersDevExceptionRef,
    affected_deployments: ["api-staging"],
    old_provider_target_identity: providerTargetIdentity,
    shared_lock_scope: providerTargetIdentity,
    approval_evidence: "RFC-PR25-WORKERS-DEV",
    ...overrides,
  });
}

test("cloudflare-containers workers.dev exception requires reviewed non-production scope", () => {
  assert.match(
    extract([deploymentNode()]).errors.join("\n"),
    /workers_dev_exception requires an active reviewed target_exception/,
  );

  assert.match(
    extract([
      workersDevExceptionNode(),
      deploymentNode({ protection_class: "production_facing" }),
    ]).errors.join("\n"),
    /production_facing cloudflare-containers deployments require a custom domain/,
  );

  assert.match(
    extract([
      workersDevExceptionNode({
        old_provider_target_identity: `cloudflare-containers:${accountId}/other-worker`,
      }),
      deploymentNode({
        target_exceptions: [workersDevExceptionRef],
      }),
    ]).errors.join("\n"),
    /workers_dev_exception requires an active reviewed target_exception/,
  );

  const { deployments, errors } = extract([
    workersDevExceptionNode(),
    deploymentNode({
      target_exceptions: [workersDevExceptionRef],
    }),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(
    (deployments[0]?.providerTarget as any).canonicalUrl,
    "https://api-staging.workers.dev/",
  );
});
