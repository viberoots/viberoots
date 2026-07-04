#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import {
  appNode,
  cloudflareDeployment,
  cloudflareNodes,
  s3Deployment,
  s3Nodes,
  withEnv,
  withProjectConfig,
  writeJson,
} from "./deployment-contexts.scope.helpers";
import {
  appStoreConnectAdmissionPolicyNodeFixture,
  appStoreConnectDeploymentNodeFixture,
  appStoreConnectLanePolicyNodeFixture,
} from "./app-store-connect.fixture";
import {
  googlePlayAdmissionPolicyNodeFixture,
  googlePlayDeploymentNodeFixture,
  googlePlayLanePolicyNodeFixture,
} from "./google-play.fixture";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";
import { vercelPolicyNodes } from "./vercel.fixture";

test("resource inventory maps representative provider families to provider targets", () => {
  const cases: Array<[string, GraphNode[]]> = [
    [
      "cloudflare-pages",
      cloudflareNodes([
        cloudflareDeployment({
          provider_target: { account: "web-platform-staging", project: "sample-webapp-staging" },
        }),
      ]),
    ],
    [
      "s3-static",
      s3Nodes([
        s3Deployment({
          provider_target: {
            account: "web-platform-staging",
            bucket: "sample-webapp-staging-site",
            region: "us-west-2",
          },
        }),
      ]),
    ],
    [
      "google-play",
      mobileNodes([
        googlePlayLanePolicyNodeFixture(),
        googlePlayAdmissionPolicyNodeFixture({ required_approvals: ["release-owner"] }),
        googlePlayDeploymentNodeFixture(),
      ]),
    ],
    [
      "app-store-connect",
      mobileNodes([
        appStoreConnectLanePolicyNodeFixture(),
        appStoreConnectAdmissionPolicyNodeFixture({ required_approvals: ["release-owner"] }),
        appStoreConnectDeploymentNodeFixture(),
      ]),
    ],
    [
      "vercel",
      [
        ...vercelPolicyNodes(),
        appNode({ name: "//projects/apps/console:app", labels: ["kind:app", "webapp:ssr"] }),
        vercelNode(),
      ],
    ],
  ];
  for (const [provider, nodes] of cases) {
    const inventory = createDeploymentResourceInventory(nodes);
    assert.deepEqual(inventory.errors, [], provider);
    const target = inventory.resources.find(
      (resource) => resource.kind === "ProviderTarget" && resource.facts?.provider === provider,
    );
    assert.ok(target, `${provider} provider target missing`);
    assertProviderCapabilityBinding(target, provider);
  }
});

test("resource inventory fixtures cover every supported deployment query root", () => {
  const roots = [
    "projects/deployments",
    "projects/apps",
    "projects/libs",
    "sandbox/deployments",
    "sandbox/apps",
    "sandbox/libs",
  ];
  const inventory = createDeploymentResourceInventory(
    cloudflareNodes([
      appNode({ name: "//projects/libs/shared:app", labels: ["kind:app", "webapp:pwa"] }),
      appNode({ name: "//sandbox/apps/demo:app", labels: ["kind:app", "webapp:pwa"] }),
      appNode({ name: "//sandbox/libs/shared:app", labels: ["kind:app", "webapp:pwa"] }),
      cloudflareDeployment({
        name: "//projects/deployments/query-root-app:deploy",
        component: "//projects/apps/sample-webapp:app",
        provider_target: { account: "web-platform", project: "query-root-app" },
      }),
      cloudflareDeployment({
        name: "//projects/deployments/query-root-project:deploy",
        component: "//projects/libs/shared:app",
        provider_target: { account: "web-platform", project: "query-root-project" },
      }),
      cloudflareDeployment({
        name: "//sandbox/deployments/query-root-sandbox:deploy",
        component: "//sandbox/apps/demo:app",
        provider_target: { account: "web-platform", project: "query-root-sandbox" },
      }),
      cloudflareDeployment({
        name: "//sandbox/deployments/query-root-lib:deploy",
        component: "//sandbox/libs/shared:app",
        provider_target: { account: "web-platform", project: "query-root-lib" },
      }),
    ]),
  );
  assert.deepEqual(inventory.errors, []);
  const serialized = JSON.stringify(inventory.resources);
  for (const root of roots) assert.match(serialized, new RegExp(`//${root.replace("/", "\\/")}`));
});

test("resource inventory fails closed for unsupported extracted deployment concepts", () => {
  const inventory = createDeploymentResourceInventory([
    appNode(),
    {
      name: "//projects/deployments/unknown:deploy",
      provider: "unsupported-provider",
      component: "//projects/apps/sample-webapp:app",
      component_kind: "static-webapp",
      publisher: "unknown",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/sample-webapp/shared:lane",
      environment_stage: "staging",
      admission_policy: "//projects/deployments/sample-webapp/shared:staging_release",
      provider_target: {},
    },
  ]);
  assert.match(inventory.errors.join("\n"), /unsupported deployment provider/);
});

function assertProviderCapabilityBinding(
  target: NonNullable<ReturnType<typeof createDeploymentResourceInventory>["resources"][number]>,
  provider: string,
) {
  assert.ok(target.refs?.includes(`provider-capability:${provider}`), provider);
  assert.equal(target.facts?.providerCapabilityId, `provider-capability:${provider}`);
  assert.equal(
    target.facts?.providerCapabilitySource,
    `build-tools/tools/deployments/provider-capabilities/${provider}.ts`,
  );
  assert.equal(target.facts?.authorityBoundary, "reviewed-provider-capability-registry");
  assert.equal((target.facts?.referenceRules as any)?.registryKey, provider);
  assert.ok((target.facts?.canonicalTargetIdentityFields as unknown[]).length > 0);
  assert.ok((target.facts?.publisherTypes as unknown[]).length > 0);
}

test("resource inventory fails closed when source-mode local overrides are disabled", async () => {
  await withProjectConfig(
    {
      controlPlanes: {
        prod: {
          serviceClient: {
            controlPlaneUrl: "https://control.example",
            controlPlaneTokenRef: "secret://control/prod/token",
          },
        },
      },
      deploymentContexts: {
        app: {
          controlPlane: "prod",
          cloudflare: { account: "web-platform", projectName: "sample-webapp-prod" },
        },
      },
    },
    async () => {
      await writeJson("projects/config/local.json", {
        schemaVersion: "viberoots-project-config@1",
        deploymentContexts: { app: { cloudflare: { projectName: "local-only" } } },
      });
      await withEnv("VBR_DISALLOW_LOCAL_OVERRIDES", "1", async () => {
        const inventory = createDeploymentResourceInventory(
          cloudflareNodes([cloudflareDeployment({ deployment_context: "app" })]),
        );
        assert.match(inventory.errors.join("\n"), /local project config overrides are disabled/);
      });
    },
  );
});

function mobileNodes(nodes: GraphNode[]): GraphNode[] {
  return [
    appNode({ name: "//projects/apps/demo-android:release", labels: ["kind:app", "mobile"] }),
    appNode({ name: "//projects/apps/demo-ios:release", labels: ["kind:app", "mobile"] }),
    nixosSharedHostLaneGovernanceNodeFixture({
      source_ref_policies: [
        { stage: "dev", allowed_refs: "main", required_checks: "" },
        { stage: "staging", allowed_refs: "main", required_checks: "" },
        { stage: "prod", allowed_refs: "refs/tags/release/fixture", required_checks: "" },
      ],
      required_approval_boundaries: [
        { stage: "dev", required_approvals: "release-owner" },
        { stage: "staging", required_approvals: "release-owner" },
        { stage: "prod", required_approvals: "release-owner" },
      ],
    }),
    ...nodes,
  ];
}

function vercelNode(): GraphNode {
  return {
    name: "//projects/deployments/console-staging:deploy",
    provider: "vercel",
    component: "//projects/apps/console:app",
    component_kind: "ssr-webapp",
    publisher: "vercel-prebuilt",
    publisher_config: "vercel-prebuilt.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/sample-webapp/shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/sample-webapp/shared:staging_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: { team: "web-platform", project: "console-staging", environment: "staging" },
  };
}
