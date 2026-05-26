#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
import {
  CLOUDFLARE_EXTRACTION_QUERY,
  writeCloudflarePagesExtractionFixture,
} from "./cloudflare-pages.extraction.fixture";
import {
  CUTOVER_APP,
  CUTOVER_FAMILY,
  CUTOVER_PROD,
  CUTOVER_SHARED,
  CUTOVER_STAGING,
  CUTOVER_TOKEN_CONTRACT,
  writeCutoverDeploymentFixture,
} from "./infisical-cutover.fixture";

const ATTRS =
  "name,rule_type,buck.type,provider,component,component_kind,publisher,publisher_config,protection_class,lane_policy,environment_stage,admission_policy,provider_target,vault_runtime,preview,prerequisites,secret_requirements,runtime_config_requirements,release_actions,target_exceptions,governance_policy,defaults,default_client_profile,scm_backend,repository,source_ref_policies,trusted_reporter_identities,required_approval_boundaries,stages,source_ref_policy,allowed_promotion_edges,artifact_reuse_mode,promotion_compatibility,allowed_refs,required_checks,required_approvals,retry_branch_policy,retry_approval_reuse,artifact_attestation_mode,labels".split(
    ",",
  );

function assertCloudflareApiTokenSteps(
  deployment: {
    secretRequirements: Array<{
      name: string;
      step: string;
      contractId: string;
      required: boolean;
    }>;
  },
  expectedSteps = ["preview_cleanup", "publish"],
  expectedContractId = "secret://deployments/pleomino/cloudflare_api_token",
) {
  const expected = expectedSteps.map((step) => [step, expectedContractId, true]).sort();
  assert.deepEqual(
    deployment.secretRequirements
      .filter((requirement) => requirement.name === "cloudflare_api_token")
      .map((requirement) => [requirement.step, requirement.contractId, requirement.required])
      .sort(),
    expected,
  );
}

test("cloudflare-pages deployment extraction reads canonical metadata from TARGETS via cquery", async () => {
  await runInTemp("cloudflare-pages-cquery-extraction", async (tmp, _$) => {
    await writeCloudflarePagesExtractionFixture(tmp);

    const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const cquery = await _$({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cloudflare-pages-cquery")} cquery --target-platforms prelude//platforms:default ${CLOUDFLARE_EXTRACTION_QUERY} --json ${attrFlags}`.quiet();
    const merged = JSON.parse(String(cquery.stdout || "")) as Record<string, any>;
    const { deployments, errors } = extractCloudflarePagesDeployments(nodesFromCqueryJson(merged));
    assert.deepEqual(errors, []);
    assert.equal(deployments.length, 1);
    assert.equal(deployments[0]?.label, "//projects/deployments/pleomino/staging:deploy");
    assert.equal(deployments[0]?.lanePolicy.defaultClientProfile, "mini");
    assert.deepEqual(deployments[0]?.lanePolicy.sourceRefPolicy, {
      dev: "main",
      staging: "main",
      prod: "refs/tags/release/*",
    });
    const stagingSourcePolicy = deployments[0]?.lanePolicy.governance.sourceRefPolicies.find(
      (policy) => policy.stage === "staging",
    );
    assert.deepEqual(stagingSourcePolicy?.allowedRefs, ["main", "refs/tags/release/*"]);
    assert.deepEqual(stagingSourcePolicy?.requiredChecks, ["deploy/pleomino-staging"]);
    assert.deepEqual(deployments[0]?.lanePolicy.governance.trustedReporterIdentities, [
      "app:deploy-bot",
      "ci:jenkins",
    ]);
    assert.deepEqual(deployments[0]?.lanePolicy.governance.requiredApprovalBoundaries, [
      { stage: "prod", requiredApprovals: ["release-owner"] },
    ]);
    assert.equal(deployments[0]?.publisher.config, "wrangler.jsonc");
    assert.equal(deployments[0]?.providerTarget.account, "web-platform-staging");
    assert.equal(deployments[0]?.providerTarget.project, "pleomino-staging-pages");
    assert.equal(deployments[0]?.providerTarget.customDomain, "staging.pleomino.com");
    assert.equal(deployments[0]?.providerTarget.customDomainZoneId, "zone-pleomino");
    assert.equal(deployments[0]?.providerTarget.canonicalUrl, "https://staging.pleomino.com/");
    assert.deepEqual(deployments[0]?.prerequisites, []);
    assert.equal(deployments[0]?.preview?.identitySelector, "source_run");
    assertCloudflareApiTokenSteps(deployments[0]!, ["preview_cleanup", "provision", "publish"]);
  });
});

test("cutover fixture Cloudflare TARGETS emit publish and cleanup token requirements", async () => {
  await runInTemp("cloudflare-pages-cutover-cquery", async (tmp, _$) => {
    await writeCutoverDeploymentFixture(tmp);

    const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query = `set(${[
      CUTOVER_STAGING,
      CUTOVER_PROD,
      CUTOVER_APP,
      `${CUTOVER_SHARED}:lane`,
      `${CUTOVER_SHARED}:defaults`,
      `${CUTOVER_SHARED}:lane_governance`,
      `${CUTOVER_SHARED}:staging_release`,
      `${CUTOVER_SHARED}:prod_release`,
    ].join(" ")})`;
    const cquery = await _$({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cloudflare-pages-cutover-cquery")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
    const merged = JSON.parse(String(cquery.stdout || "")) as Record<string, any>;
    const { deployments, errors } = extractCloudflarePagesDeployments(nodesFromCqueryJson(merged));
    assert.deepEqual(errors, []);
    assert.equal(deployments.length, 2);
    for (const deployment of deployments)
      assert.equal(deployment.lanePolicy.defaultClientProfile, "mini");

    const staging = deployments.find(
      (deployment) => deployment.deploymentId === `${CUTOVER_FAMILY}-staging`,
    );
    const prod = deployments.find(
      (deployment) => deployment.deploymentId === `${CUTOVER_FAMILY}-prod`,
    );
    assert.equal(staging?.label, CUTOVER_STAGING);
    assert.equal(staging?.providerTarget.accountId, "11111111111111111111111111111111");
    assert.equal(staging?.providerTarget.customDomain, `staging.${CUTOVER_FAMILY}.example.test`);
    assert.equal(staging?.providerTarget.customDomainZoneId, "zone-cutover");
    assert.equal(
      staging?.providerTarget.canonicalUrl,
      `https://staging.${CUTOVER_FAMILY}.example.test/`,
    );
    assert.equal(prod?.label, CUTOVER_PROD);
    assert.equal(prod?.providerTarget.accountId, "11111111111111111111111111111111");
    assert.equal(prod?.providerTarget.customDomain, `prod.${CUTOVER_FAMILY}.example.test`);
    assert.equal(prod?.providerTarget.customDomainZoneId, "zone-cutover");
    assert.equal(prod?.providerTarget.canonicalUrl, `https://prod.${CUTOVER_FAMILY}.example.test/`);
    assertCloudflareApiTokenSteps(
      staging!,
      ["preview_cleanup", "provision", "publish"],
      CUTOVER_TOKEN_CONTRACT,
    );
    assertCloudflareApiTokenSteps(
      prod!,
      ["preview_cleanup", "provision", "publish"],
      CUTOVER_TOKEN_CONTRACT,
    );
  });
});
