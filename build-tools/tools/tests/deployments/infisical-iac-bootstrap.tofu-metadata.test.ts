#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  normalizeDeploymentRuntimeMetadata,
  readDeploymentRuntimeMetadata,
} from "../../deployments/infisical-iac-bootstrap-tofu";

test("OpenTofu output reader parses deployment runtime metadata", () => {
  const metadata = readDeploymentRuntimeMetadata(
    {
      ...DEFAULT_BOOTSTRAP_ARGS,
      mode: "deployment",
      target: "//projects/deployments/example/staging:deploy",
    },
    () =>
      JSON.stringify({
        staging: {
          site_url: "https://app.infisical.com/api/",
          project_id: "project_1",
          project_name: "example-deployments",
          project_slug: "example-deployments",
          environment: "staging",
          secret_path: "/",
          cloudflare_secret_name: "cloudflare_api_token",
          machine_identity_id: "identity_1",
          machine_identity_name: "example-staging-deploy",
          client_id_file_name: "example-staging-infisical-client-id",
          client_secret_file_name: "example-staging-infisical-client-secret",
        },
      }),
  );
  assert.equal(metadata.siteUrl, "https://app.infisical.com");
  assert.equal(metadata.projectId, "project_1");
  assert.equal(metadata.projectName, "example-deployments");
  assert.equal(metadata.projectSlug, "example-deployments");
  assert.equal(metadata.secretPath, "/");
  assert.equal(metadata.cloudflareSecretName, "cloudflare_api_token");
  assert.equal(metadata.environments?.staging?.slug, "staging");
  assert.equal(metadata.deploymentCredentials?.[0]?.identityId, "identity_1");
});

test("OpenTofu stage-map normalization derives stable secret refs from real output shape", () => {
  const metadata = normalizeDeploymentRuntimeMetadata(
    {
      prod: {
        site_url: "https://app.infisical.com",
        project_id: "project_1",
        project_name: "example-deployments",
        project_slug: "example-deployments",
        environment: "prod",
        secret_path: "/",
        cloudflare_secret_name: "cloudflare_api_token",
        machine_identity_id: "identity_prod",
        machine_identity_name: "example-prod-deploy",
        client_id_file_name: "example-prod-infisical-client-id",
        client_secret_file_name: "example-prod-infisical-client-secret",
      },
    },
    { family: "example" },
  );
  assert.equal(
    metadata.deploymentCredentials?.[0]?.clientIdRef,
    "secret://deployments/example/prod/infisical-client-id",
  );
  assert.equal(
    metadata.deploymentCredentials?.[0]?.clientSecretFileName,
    "example-prod-infisical-client-secret",
  );
});
