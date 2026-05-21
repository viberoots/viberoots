#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  extractDeployments,
  type CloudflareContainersDeployment,
} from "../../deployments/contract";
import { prepareCloudflareContainersWranglerConfig } from "../../deployments/cloudflare-containers-config";
import type { GraphNode } from "../../lib/graph";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";
import { deploymentTargetExceptionNodeFixture } from "./deployment-metadata.fixture";

const accountId = "0123456789abcdef0123456789abcdef";
const providerTargetIdentity = `cloudflare-containers:${accountId}/api-staging`;
const workersDevExceptionRef = "//projects/deployments/pleomino/shared:api_workers_dev";
const publicProviderTarget = {
  account_id: accountId,
  worker: "api-staging",
  ingress_mode: "public",
  domain: "api.example.com",
  cloudflare_zone_id: accountId,
  container_port: "8080",
  workers_dev_exception: "false",
  sleep_after: "10m",
  max_instances: "1",
};

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
    lane_policy: "//projects/deployments/pleomino/shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/pleomino/shared:staging_release",
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

async function prepareConfig(
  deployment: CloudflareContainersDeployment,
  wrangler: string,
): Promise<void> {
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "containers-config-"));
  const deployRoot = path.join(workspaceRoot, "projects/deployments/api-staging");
  await fsp.mkdir(deployRoot, { recursive: true });
  await fsp.writeFile(path.join(deployRoot, "wrangler.jsonc"), wrangler, "utf8");
  await prepareCloudflareContainersWranglerConfig({
    workspaceRoot,
    deployment,
    outputPath: path.join(workspaceRoot, "out.json"),
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

test("cloudflare-containers provider config semantics follow ingress metadata", async () => {
  const publicDeployment = extract([deploymentNode({ provider_target: publicProviderTarget })])
    .deployments[0] as CloudflareContainersDeployment;
  await prepareConfig(
    publicDeployment,
    `{"name":"api-staging","routes":[{"pattern":"api.example.com","custom_domain":true,"zone_id":"${accountId}"}],"containers":[{"max_instances":1,"sleep_after":"10m"}]}`,
  );

  for (const ingressMode of ["private", "none"]) {
    const deployment = extract([
      deploymentNode({
        provider_target: {
          ...publicProviderTarget,
          ingress_mode: ingressMode,
          domain: "",
          cloudflare_zone_id: "",
        },
      }),
    ]).deployments[0] as CloudflareContainersDeployment;
    await prepareConfig(
      deployment,
      '{"name":"api-staging","containers":[{"max_instances":1,"sleep_after":"10m"}]}',
    );
  }

  await assert.rejects(
    () =>
      prepareConfig(
        publicDeployment,
        '{"name":"api-staging","containers":[{"max_instances":1,"sleep_after":"10m"}]}',
      ),
    /missing route for domain api.example.com/,
  );
});
