#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMetadataHandoffPatch } from "../../deployments/infisical-iac-bootstrap-metadata-handoff";
import { parseDeploymentReviewedMetadata } from "../../deployments/infisical-iac-bootstrap-reviewed-metadata";

test("metadata handoff rejects non-contract credential file names", () => {
  const reviewed = parseDeploymentReviewedMetadata(SOURCE);
  assert.throws(
    () => buildMetadataHandoffPatch(LIVE_METADATA, reviewed, SOURCE),
    /metadata handoff staging client_id file name must be exactly sample-webapp-staging-infisical-client-id/,
  );
});

const LIVE_METADATA = {
  siteUrl: "https://app.infisical.com",
  projectName: "sample-webapp-deployments",
  projectId: "proj_live",
  projectSlug: "sample-webapp-deployments",
  secretPath: "/",
  cloudflareSecretName: "cloudflare_api_token",
  environments: { staging: { slug: "staging" } },
  deploymentCredentials: [
    {
      stage: "staging",
      identityId: "identity_live_staging",
      identityName: "sample-webapp-staging-deploy",
      clientIdRef: "secret://deployments/sample-webapp/staging/infisical-client-id",
      clientSecretRef: "secret://deployments/sample-webapp/staging/infisical-client-secret",
      clientIdFileName: "sample-webapp-staging-client-id",
      clientSecretFileName: "sample-webapp-staging-client-secret",
    },
  ],
};

const SOURCE = `
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "proj_sample_webapp_deployments"
_INFISICAL_PROJECT_NAME = "sample-webapp-deployments"
_INFISICAL_PROJECT_SLUG = "sample-webapp-deployments"
_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging"}
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "identity_sample_webapp_staging_deploy"}
_INFISICAL_MACHINE_IDENTITY_NAMES = {"staging": "sample-webapp-staging-deploy"}
_INFISICAL_CREDENTIAL_FILE_NAMES = {
  "staging": {"client_id": "", "client_secret": ""},
}
_INFISICAL_CREDENTIAL_REFS = {
  "staging": {
    "client_id": "secret://deployments/sample-webapp/staging/infisical-client-id",
    "client_secret": "secret://deployments/sample-webapp/staging/infisical-client-secret",
  },
}
`;
