#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import {
  deriveCloudflarePagesProviderTarget,
  extractCloudflarePagesDeployments,
} from "../../deployments/contract.ts";
import { deriveCloudflarePagesPreviewTarget } from "../../deployments/cloudflare-pages-preview.ts";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesDeploymentFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
  cloudflarePagesPreviewFixture,
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

test("deriveCloudflarePagesProviderTarget uses custom domain as canonical url", () => {
  const target = deriveCloudflarePagesProviderTarget({
    account: "web-platform-staging",
    project: "pleomino-staging-pages",
    customDomain: "staging.pleomino.com",
    customDomainZoneId: "zone-pleomino",
  });
  assert.equal(target.customDomain, "staging.pleomino.com");
  assert.equal(target.customDomainZoneId, "zone-pleomino");
  assert.equal(target.canonicalUrl, "https://staging.pleomino.com/");
  assert.equal(
    target.providerTargetIdentity,
    "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  );
});

test("extractCloudflarePagesDeployments reads provider target and publisher config", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/pleomino:app"),
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture({
      name: "//projects/deployments/pleomino-shared:dev_release",
      allowed_refs: ["env/pleomino/dev"],
      required_checks: ["deploy/pleomino-dev"],
    }),
    {
      name: "//projects/deployments/pleomino-dev:deploy",
      provider: "cloudflare-pages",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "wrangler-pages",
      publisher_config: "wrangler.jsonc",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "dev",
      admission_policy: "//projects/deployments/pleomino-shared:dev_release",
      secret_requirements: [],
      runtime_config_requirements: [],
      provider_target: {
        account: "web-platform-dev",
        project: "pleomino-dev-pages",
      },
    },
    {
      name: "//projects/deployments/pleomino-staging:deploy",
      provider: "cloudflare-pages",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "wrangler-pages",
      publisher_config: "wrangler.jsonc",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "staging",
      admission_policy: "//projects/deployments/pleomino-shared:staging_release",
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
      prerequisites: [{ deployment_id: "pleomino-dev", mode: "ordering_only" }],
      provider_target: {
        account: "web-platform-staging",
        custom_domain: "staging.pleomino.com",
        custom_domain_zone_id: "zone-pleomino",
        project: "pleomino-staging-pages",
      },
    },
  ];

  const { deployments, errors } = extractCloudflarePagesDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 2);
  assert.deepEqual(deployments[0]?.prerequisites, []);
  assert.equal(deployments[1]?.publisher.config, "wrangler.jsonc");
  assert.deepEqual(deployments[1]?.prerequisites, [
    { deploymentId: "pleomino-dev", mode: "ordering_only" },
  ]);
  assert.equal(deployments[1]?.providerTarget.id, "pleomino-staging-pages");
  assert.equal(deployments[1]?.providerTarget.customDomain, "staging.pleomino.com");
  assert.equal(deployments[1]?.providerTarget.customDomainZoneId, "zone-pleomino");
  assert.equal(deployments[1]?.providerTarget.canonicalUrl, "https://staging.pleomino.com/");
  assert.equal(deployments[1]?.preview?.identitySelector, "source_run");
  assert.equal(
    deployments[1]?.providerTarget.providerTargetIdentity,
    "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
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
    `cloudflare-pages:web-platform-staging/pleomino-staging-pages#preview:${previewTarget.previewBranch}`,
  );
  assert.equal(
    previewTarget.canonicalUrl,
    `https://${previewTarget.previewBranch}.pleomino-staging-pages.pages.dev/`,
  );
});
