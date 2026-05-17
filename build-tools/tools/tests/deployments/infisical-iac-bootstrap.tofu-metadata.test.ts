#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  normalizeDeploymentRuntimeMetadata,
  readDeploymentRuntimeMetadata,
} from "../../deployments/infisical-iac-bootstrap-tofu";

test("OpenTofu output reader parses deployment runtime metadata", () => {
  const metadata = readDeploymentRuntimeMetadata(DEFAULT_BOOTSTRAP_ARGS, () =>
    JSON.stringify({
      staging: {
        site_url: "https://us.infisical.com/api/",
        project_id: "project_1",
        project_name: "pleomino-deployments",
        project_slug: "pleomino-deployments",
        environment: "staging",
        secret_path: "/",
        cloudflare_secret_name: "cloudflare_api_token",
        machine_identity_id: "identity_1",
        machine_identity_name: "pleomino-staging-deploy",
        client_id_file_name: "pleomino-staging-infisical-client-id",
        client_secret_file_name: "pleomino-staging-infisical-client-secret",
      },
    }),
  );
  assert.equal(metadata.siteUrl, "https://us.infisical.com");
  assert.equal(metadata.projectId, "project_1");
  assert.equal(metadata.projectName, "pleomino-deployments");
  assert.equal(metadata.projectSlug, "pleomino-deployments");
  assert.equal(metadata.secretPath, "/");
  assert.equal(metadata.cloudflareSecretName, "cloudflare_api_token");
  assert.equal(metadata.environments?.staging?.slug, "staging");
  assert.equal(metadata.deploymentCredentials?.[0]?.identityId, "identity_1");
});

test("OpenTofu stage-map normalization derives stable secret refs from real output shape", () => {
  const metadata = normalizeDeploymentRuntimeMetadata({
    prod: {
      site_url: "https://us.infisical.com",
      project_id: "project_1",
      project_name: "pleomino-deployments",
      project_slug: "pleomino-deployments",
      environment: "prod",
      secret_path: "/",
      cloudflare_secret_name: "cloudflare_api_token",
      machine_identity_id: "identity_prod",
      machine_identity_name: "pleomino-prod-deploy",
      client_id_file_name: "pleomino-prod-infisical-client-id",
      client_secret_file_name: "pleomino-prod-infisical-client-secret",
    },
  });
  assert.equal(
    metadata.deploymentCredentials?.[0]?.clientIdRef,
    "secret://deployments/pleomino/prod/infisical-client-id",
  );
  assert.equal(
    metadata.deploymentCredentials?.[0]?.clientSecretFileName,
    "pleomino-prod-infisical-client-secret",
  );
});
