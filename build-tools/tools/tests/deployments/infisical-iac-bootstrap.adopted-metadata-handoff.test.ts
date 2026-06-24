#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileDeploymentMetadata } from "../../deployments/infisical-iac-bootstrap-reconcile";
import { parseDeploymentReviewedContextConfig } from "../../deployments/infisical-iac-bootstrap-reviewed-metadata";

test("adopted project metadata drift becomes a reviewed handoff patch", () => {
  const source = SOURCE.replaceAll("proj_old", "reviewed-live-project").replace(
    "identity_old_staging",
    "reviewed-live-staging-identity",
  );
  const reviewed = parseDeploymentReviewedContextConfig(source, "fixture");
  const result = reconcileDeploymentMetadata(LIVE_METADATA, reviewed, source, {
    allowReviewedIdHandoff: true,
  });
  assert.equal(result.status, "metadata_handoff_required");
  assert.match(result.patch.unifiedDiff, /proj_live/);
  assert.match(result.patch.unifiedDiff, /identity_live_staging/);
});

test("adopted project metadata handoff still requires live ids", () => {
  const source = SOURCE.replace("proj_old", "reviewed-live-project");
  const reviewed = parseDeploymentReviewedContextConfig(source, "fixture");
  assert.throws(
    () =>
      reconcileDeploymentMetadata({ ...LIVE_METADATA, projectId: undefined }, reviewed, source, {
        allowReviewedIdHandoff: true,
      }),
    /project id: live=<missing> reviewed=reviewed-live-project/,
  );
});

test("adopted project metadata handoff does not relax reviewed file-name drift", () => {
  const reviewed = parseDeploymentReviewedContextConfig(SOURCE, "fixture");
  assert.throws(
    () =>
      reconcileDeploymentMetadata(
        {
          ...LIVE_METADATA,
          deploymentCredentials: [
            {
              ...LIVE_METADATA.deploymentCredentials[0],
              clientIdFileName: "unexpected-client-id-file",
            },
          ],
        },
        reviewed,
        SOURCE,
        { allowReviewedIdHandoff: true },
      ),
    /staging client id file name: live=unexpected-client-id-file reviewed=fixture-staging-infisical-client-id/,
  );
});

const LIVE_METADATA = {
  siteUrl: "https://app.infisical.com",
  projectName: "fixture-deployments",
  projectId: "proj_live",
  projectSlug: "fixture-deployments",
  secretPath: "/",
  cloudflareSecretName: "cloudflare_api_token",
  environments: { staging: { slug: "staging" }, prod: { slug: "prod" } },
  deploymentCredentials: [
    {
      stage: "staging",
      identityId: "identity_live_staging",
      identityName: "fixture-staging-deploy",
      clientIdRef: "secret://deployments/fixture/staging/infisical-client-id",
      clientSecretRef: "secret://deployments/fixture/staging/infisical-client-secret",
      clientIdFileName: "fixture-staging-infisical-client-id",
      clientSecretFileName: "fixture-staging-infisical-client-secret",
    },
    {
      stage: "prod",
      identityId: "identity_live_prod",
      identityName: "fixture-prod-deploy",
      clientIdRef: "secret://deployments/fixture/prod/infisical-client-id",
      clientSecretRef: "secret://deployments/fixture/prod/infisical-client-secret",
      clientIdFileName: "fixture-prod-infisical-client-id",
      clientSecretFileName: "fixture-prod-infisical-client-secret",
    },
  ],
};

const SOURCE = `${JSON.stringify(
  {
    deploymentContexts: {
      "fixture-staging": {
        infisical: {
          host: "https://app.infisical.com",
          projectId: "proj_old",
          projectName: "fixture-deployments",
          projectSlug: "fixture-deployments",
          environment: "staging",
          defaultPath: "/",
          machineIdentityId: "identity_old_staging",
          machineIdentityName: "fixture-staging-deploy",
          clientIdRef: "secret://deployments/fixture/staging/infisical-client-id",
          clientSecretRef: "secret://deployments/fixture/staging/infisical-client-secret",
          clientIdFileName: "fixture-staging-infisical-client-id",
          clientSecretFileName: "fixture-staging-infisical-client-secret",
        },
        cloudflare: { apiTokenRef: "secret://deployments/fixture/cloudflare_api_token" },
      },
      "fixture-prod": {
        infisical: {
          host: "https://app.infisical.com",
          projectId: "proj_old",
          projectName: "fixture-deployments",
          projectSlug: "fixture-deployments",
          environment: "prod",
          defaultPath: "/",
          machineIdentityId: "identity_old_prod",
          machineIdentityName: "fixture-prod-deploy",
          clientIdRef: "secret://deployments/fixture/prod/infisical-client-id",
          clientSecretRef: "secret://deployments/fixture/prod/infisical-client-secret",
          clientIdFileName: "fixture-prod-infisical-client-id",
          clientSecretFileName: "fixture-prod-infisical-client-secret",
        },
        cloudflare: { apiTokenRef: "secret://deployments/fixture/cloudflare_api_token" },
      },
    },
  },
  null,
  2,
)}\n`;
