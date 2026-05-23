#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileDeploymentMetadata } from "../../deployments/infisical-iac-bootstrap-reconcile";
import { parsePleominoReviewedMetadata } from "../../deployments/infisical-iac-bootstrap-reviewed-metadata";

test("adopted project metadata drift becomes a reviewed handoff patch", () => {
  const source = SOURCE.replace("proj_old", "reviewed-live-project").replace(
    "identity_old_staging",
    "reviewed-live-staging-identity",
  );
  const reviewed = parsePleominoReviewedMetadata(source);
  const result = reconcileDeploymentMetadata(LIVE_METADATA, reviewed, source, {
    allowReviewedIdHandoff: true,
  });
  assert.equal(result.status, "metadata_handoff_required");
  assert.match(result.patch.unifiedDiff, /proj_live/);
  assert.match(result.patch.unifiedDiff, /identity_live_staging/);
});

test("adopted project metadata handoff still requires live ids", () => {
  const source = SOURCE.replace("proj_old", "reviewed-live-project");
  const reviewed = parsePleominoReviewedMetadata(source);
  assert.throws(
    () =>
      reconcileDeploymentMetadata({ ...LIVE_METADATA, projectId: undefined }, reviewed, source, {
        allowReviewedIdHandoff: true,
      }),
    /project id: live=<missing> reviewed=reviewed-live-project/,
  );
});

const LIVE_METADATA = {
  siteUrl: "https://app.infisical.com",
  projectName: "pleomino-deployments",
  projectId: "proj_live",
  projectSlug: "pleomino-deployments",
  secretPath: "/",
  cloudflareSecretName: "cloudflare_api_token",
  environments: { staging: { slug: "staging" } },
  deploymentCredentials: [
    {
      stage: "staging",
      identityId: "identity_live_staging",
      identityName: "pleomino-staging-deploy",
      clientIdRef: "secret://deployments/pleomino/staging/infisical-client-id",
      clientSecretRef: "secret://deployments/pleomino/staging/infisical-client-secret",
      clientIdFileName: "pleomino-staging-client-id",
      clientSecretFileName: "pleomino-staging-client-secret",
    },
  ],
};

const SOURCE = `
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "proj_old"
_INFISICAL_PROJECT_NAME = "pleomino-deployments"
_INFISICAL_PROJECT_SLUG = "pleomino-deployments"
_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging"}
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "identity_old_staging"}
_INFISICAL_MACHINE_IDENTITY_NAMES = {"staging": "pleomino-staging-deploy"}
_INFISICAL_CREDENTIAL_FILE_NAMES = {
  "staging": {"client_id": "", "client_secret": ""},
}
_INFISICAL_CREDENTIAL_REFS = {
  "staging": {
    "client_id": "secret://deployments/pleomino/staging/infisical-client-id",
    "client_secret": "secret://deployments/pleomino/staging/infisical-client-secret",
  },
}
`;
