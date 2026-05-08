#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { smokeCloudflareContainersRouting } from "../../deployments/cloudflare-containers-routing-smoke";
import {
  extractDeployments,
  type CloudflareContainersDeployment,
} from "../../deployments/contract";
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
      { id: "default", kind: "service", target: "//projects/apps/api:service_artifact" },
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
    },
    ...overrides,
  };
}

function deployment(overrides: Partial<GraphNode> = {}): CloudflareContainersDeployment {
  const { deployments, errors } = extractDeployments([
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    serviceNode(),
    deploymentNode(overrides),
  ]);
  assert.deepEqual(errors, []);
  return deployments[0] as CloudflareContainersDeployment;
}

async function startRouteDouble(opts: { expectedHost: string; expectedPrivateRoute?: string }) {
  const seen: Array<{ url?: string; host?: string; privateRoute?: string }> = [];
  const server = http.createServer((request, response) => {
    const privateRoute = String(request.headers["x-cloudflare-containers-private-route"] || "");
    seen.push({ url: request.url, host: request.headers.host, privateRoute });
    const privateOk = opts.expectedPrivateRoute ? privateRoute === opts.expectedPrivateRoute : true;
    const status = request.headers.host === opts.expectedHost && privateOk ? 200 : 403;
    response.writeHead(status, { "content-type": "text/plain" });
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("cloudflare-containers public routing smoke reaches public host and health path", async () => {
  const server = await startRouteDouble({ expectedHost: "api.example.com" });
  try {
    const result = await smokeCloudflareContainersRouting({
      deployment: deployment(),
      connectOverride: { hostname: "127.0.0.1", port: server.port },
    });
    assert.equal(result.smokeOutcome, "passed");
    assert.equal(server.seen[0]?.host, "api.example.com");
    assert.equal(server.seen[0]?.url, "/healthz");
  } finally {
    await server.close();
  }
});

test("cloudflare-containers private routing smoke uses internal private route header", async () => {
  const privateDeployment = deployment({
    provider_target: {
      account_id: accountId,
      worker: "api-staging",
      ingress_mode: "private",
      container_port: "8080",
      health_path: "/ready",
    },
  });
  const server = await startRouteDouble({
    expectedHost: "worker.internal",
    expectedPrivateRoute: privateDeployment.providerTarget.providerTargetIdentity,
  });
  try {
    const result = await smokeCloudflareContainersRouting({
      deployment: privateDeployment,
      connectOverride: { hostname: "127.0.0.1", port: server.port },
    });
    assert.equal(result.smokeOutcome, "passed");
    assert.equal(server.seen[0]?.url, "/ready");
    assert.equal(
      server.seen[0]?.privateRoute,
      privateDeployment.providerTarget.providerTargetIdentity,
    );
  } finally {
    await server.close();
  }
});
