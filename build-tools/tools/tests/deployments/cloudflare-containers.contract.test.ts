#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { extractDeployments } from "../../deployments/contract";
import { submitCloudflareContainersDeploy } from "../../deployments/cloudflare-containers-deploy";
import type { GraphNode } from "../../lib/graph";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";

const accountId = "0123456789abcdef0123456789abcdef";

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
      domain: "api.example.com",
      cloudflare_zone_id: accountId,
      container_port: "8080",
      health_path: "/healthz",
      workers_dev_exception: "false",
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

test("cloudflare-containers extraction records public service target metadata", () => {
  const { deployments, errors } = extract([deploymentNode()]);
  assert.deepEqual(errors, []);
  const deployment = deployments[0];
  assert.equal(deployment?.provider, "cloudflare-containers");
  assert.equal(
    deployment?.providerTarget.providerTargetIdentity,
    `cloudflare-containers:${accountId}/api-staging`,
  );
  assert.equal((deployment?.providerTarget as any).canonicalUrl, "https://api.example.com/");
  assert.equal((deployment?.providerTarget as any).containerPort, 8080);
});

test("cloudflare-containers extraction supports private and no-ingress metadata", () => {
  const { deployments, errors } = extract([
    deploymentNode({
      name: "//projects/deployments/api-private:deploy",
      provider_target: {
        account_id: accountId,
        worker: "api-private",
        ingress_mode: "private",
        container_port: "9090",
        health_path: "/ready",
      },
    }),
    deploymentNode({
      name: "//projects/deployments/worker-none:deploy",
      component_kind: "third-party-service",
      components: [
        {
          id: "default",
          kind: "third-party-service",
          target: "//projects/apps/api:service_artifact",
        },
      ],
      provider_target: {
        account_id: accountId,
        worker: "worker-none",
        ingress_mode: "none",
        container_port: "7070",
      },
    }),
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    deployments.map(({ providerTarget }) => ({
      ingressMode: (providerTarget as any).ingressMode,
      canonicalUrl: (providerTarget as any).canonicalUrl,
      containerPort: (providerTarget as any).containerPort,
    })),
    [
      { ingressMode: "private", canonicalUrl: undefined, containerPort: 9090 },
      { ingressMode: "none", canonicalUrl: undefined, containerPort: 7070 },
    ],
  );
});

test("cloudflare-containers validation rejects unsupported and missing metadata", () => {
  const cases: Array<[string, Partial<GraphNode>, RegExp]> = [
    [
      "component kind",
      {
        component_kind: "static-webapp",
        components: [
          {
            id: "default",
            kind: "static-webapp",
            target: "//projects/apps/api:service_artifact",
          },
        ],
      },
      /does not support component_kind/,
    ],
    [
      "account id",
      { provider_target: { worker: "api", ingress_mode: "private", container_port: "8080" } },
      /cloudflare_account_id must be/,
    ],
    [
      "public domain",
      {
        provider_target: {
          account_id: accountId,
          worker: "api",
          ingress_mode: "public",
          container_port: "8080",
        },
      },
      /require domain or reviewed workers_dev_exception/,
    ],
    [
      "ingress mode",
      {
        provider_target: {
          account_id: accountId,
          worker: "api",
          ingress_mode: "tunnel",
          container_port: "8080",
        },
      },
      /unsupported cloudflare-containers ingress_mode/,
    ],
    [
      "container port",
      { provider_target: { account_id: accountId, worker: "api", ingress_mode: "private" } },
      /container_port must be between 1 and 65535/,
    ],
  ];
  for (const [name, override, expected] of cases) {
    const { errors } = extract([deploymentNode(override)]);
    assert.match(errors.join("\n"), expected, name);
  }
});

test("cloudflare-containers fake publisher records admitted image and config fingerprint", async () => {
  const tmp = await fsp.mkdtemp(path.join(process.cwd(), "buck-out/tmp/cf-containers-"));
  const workspaceRoot = path.join(tmp, "workspace");
  const deploymentRoot = path.join(workspaceRoot, "projects/deployments/api-staging");
  const recordsRoot = path.join(tmp, "records");
  const artifactPath = path.join(tmp, "image.txt");
  await fsp.mkdir(deploymentRoot, { recursive: true });
  await fsp.writeFile(path.join(deploymentRoot, "wrangler.jsonc"), '{ "name": "api-staging" }\n');
  await fsp.writeFile(artifactPath, `sha256:${"a".repeat(64)}\n`);
  const { deployments, errors } = extract([deploymentNode({ protection_class: "local_only" })]);
  assert.deepEqual(errors, []);
  const result = await submitCloudflareContainersDeploy({
    workspaceRoot,
    deployment: deployments[0] as any,
    recordsRoot,
    artifactDir: artifactPath,
  });
  assert.equal(result.record.finalOutcome, "succeeded");
  assert.equal(result.record.artifact?.identity, `image-digest:sha256:${"a".repeat(64)}`);
  assert.equal(
    (result.record as any).providerTargetIdentity,
    `cloudflare-containers:${accountId}/api-staging`,
  );
  assert.equal((result.record as any).route, "api.example.com");
  assert.equal((result.record as any).publicUrl, "https://api.example.com/");
  assert.equal((result.record as any).smokeUrl, "https://api.example.com/");
  assert.equal((result.record as any).smokeOutcome, "passed");
  assert.match((result.record as any).workerConfigFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("cloudflare-containers fake publisher rejects ambient local Docker build inputs", async () => {
  const tmp = await fsp.mkdtemp(path.join(process.cwd(), "buck-out/tmp/cf-containers-bad-"));
  const localDockerBuild = path.join(tmp, "Dockerfile");
  await fsp.writeFile(localDockerBuild, "FROM scratch\n");
  await assert.rejects(
    async () =>
      await submitCloudflareContainersDeploy({
        workspaceRoot: tmp,
        deployment: extract([deploymentNode({ protection_class: "local_only" })])
          .deployments[0] as any,
        recordsRoot: path.join(tmp, "records"),
        artifactDir: localDockerBuild,
      }),
    /service artifact file must contain an OCI image digest/,
  );
});
