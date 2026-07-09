#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import {
  deriveCloudflarePagesProviderTarget,
  extractCloudflarePagesDeployments,
} from "../../deployments/contract";
import { deriveCloudflarePagesPreviewTarget } from "../../deployments/cloudflare-pages-preview";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesDeploymentFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
  cloudflarePagesPreviewFixture,
} from "./cloudflare-pages.fixture";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:static"],
  };
}

test("deriveCloudflarePagesProviderTarget normalizes canonical url and lock identity", () => {
  const target = deriveCloudflarePagesProviderTarget({
    account: "web-platform-staging",
    project: "sample-webapp-staging-pages",
  });
  assert.deepEqual(target, {
    account: "web-platform-staging",
    project: "sample-webapp-staging-pages",
    id: "sample-webapp-staging-pages",
    provisionMode: "managed",
    canonicalUrl: "https://sample-webapp-staging-pages.pages.dev/",
    providerTargetIdentity: "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
  });
});

test("deriveCloudflarePagesProviderTarget uses custom domain as canonical url", () => {
  const target = deriveCloudflarePagesProviderTarget({
    account: "web-platform-staging",
    accountId: "11111111111111111111111111111111",
    project: "sample-webapp-staging-pages",
    customDomain: "staging.sample-webapp.com",
    customDomainZoneId: "zone-sample-webapp",
  });
  assert.equal(target.accountId, "11111111111111111111111111111111");
  assert.equal(target.customDomain, "staging.sample-webapp.com");
  assert.equal(target.customDomainZoneId, "zone-sample-webapp");
  assert.equal(target.canonicalUrl, "https://staging.sample-webapp.com/");
  assert.equal(
    target.providerTargetIdentity,
    "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
  );
});

test("extractCloudflarePagesDeployments reads provider target and publisher config", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/sample-webapp:app"),
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture({
      name: "//projects/deployments/sample-webapp/shared:dev_release",
      allowed_refs: ["main"],
      required_checks: ["deploy/sample-webapp-dev"],
    }),
    {
      name: "//projects/deployments/sample-webapp/dev:deploy",
      provider: "cloudflare-pages",
      component: "//projects/apps/sample-webapp:app",
      component_kind: "static-webapp",
      publisher: "wrangler-pages",
      publisher_config: "wrangler.jsonc",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/sample-webapp/shared:lane",
      environment_stage: "dev",
      admission_policy: "//projects/deployments/sample-webapp/shared:dev_release",
      secret_requirements: [],
      runtime_config_requirements: [],
      provider_target: {
        account: "web-platform-dev",
        project: "sample-webapp-dev-pages",
      },
    },
    {
      name: "//projects/deployments/sample-webapp/staging:deploy",
      provider: "cloudflare-pages",
      component: "//projects/apps/sample-webapp:app",
      component_kind: "static-webapp",
      publisher: "wrangler-pages",
      publisher_config: "wrangler.jsonc",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/sample-webapp/shared:lane",
      environment_stage: "staging",
      admission_policy: "//projects/deployments/sample-webapp/shared:staging_release",
      secret_requirements: [],
      runtime_config_requirements: [],
      preview: {
        target_derivation: "provider_managed_source_run",
        isolation_class: "isolated",
        identity_selector: "source_run",
        cleanup_ttl: "7d",
        smoke_target: "preview_url",
        lock_scope: "shared",
      },
      prerequisites: [{ deployment_id: "sample-webapp-dev", mode: "ordering_only" }],
      provider_target: {
        account: "web-platform-staging",
        account_id: "11111111111111111111111111111111",
        custom_domain: "staging.sample-webapp.com",
        custom_domain_zone_id: "zone-sample-webapp",
        project: "sample-webapp-staging-pages",
      },
    },
  ];

  const { deployments, errors } = extractCloudflarePagesDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 2);
  assert.deepEqual(deployments[0]?.prerequisites, []);
  assert.equal(deployments[1]?.publisher.config, "wrangler.jsonc");
  assert.deepEqual(deployments[1]?.prerequisites, [
    { deploymentId: "sample-webapp-dev", mode: "ordering_only" },
  ]);
  assert.equal(deployments[1]?.providerTarget.id, "sample-webapp-staging-pages");
  assert.equal(deployments[1]?.providerTarget.accountId, "11111111111111111111111111111111");
  assert.equal(deployments[1]?.providerTarget.customDomain, "staging.sample-webapp.com");
  assert.equal(deployments[1]?.providerTarget.customDomainZoneId, "zone-sample-webapp");
  assert.equal(deployments[1]?.providerTarget.canonicalUrl, "https://staging.sample-webapp.com/");
  assert.equal(deployments[1]?.preview?.identitySelector, "source_run");
  assert.equal(
    deployments[1]?.providerTarget.providerTargetIdentity,
    "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
  );
});

test("deriveCloudflarePagesPreviewTarget preserves the live target while deriving an isolated preview identity", () => {
  const previewTarget = deriveCloudflarePagesPreviewTarget(
    cloudflarePagesDeploymentFixture({ preview: cloudflarePagesPreviewFixture() }),
    "deploy-123",
  );
  assert.equal(previewTarget.previewSourceRunId, "deploy-123");
  assert.match(previewTarget.previewBranch ?? "", /^prv-deploy-123-[0-9a-f]{8}$/);
  assert.ok((previewTarget.previewBranch?.length ?? 0) <= 31);
  assert.equal(
    previewTarget.providerTargetIdentity,
    `cloudflare-pages:web-platform-staging/sample-webapp-staging-pages#preview:${previewTarget.previewBranch}`,
  );
  assert.equal(
    previewTarget.canonicalUrl,
    `https://${previewTarget.previewBranch}.sample-webapp-staging-pages.pages.dev/`,
  );
});
