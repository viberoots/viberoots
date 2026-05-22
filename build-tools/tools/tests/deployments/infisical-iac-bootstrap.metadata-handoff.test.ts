#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { reconcileDeploymentMetadata } from "../../deployments/infisical-iac-bootstrap-reconcile";
import {
  applyMetadataHandoffPatch,
  buildMetadataHandoffPatch,
} from "../../deployments/infisical-iac-bootstrap-metadata-handoff";
import { parsePleominoReviewedMetadata } from "../../deployments/infisical-iac-bootstrap-reviewed-metadata";

test("placeholder reviewed metadata becomes a first-bootstrap handoff patch", () => {
  const reviewed = parsePleominoReviewedMetadata(FIRST_BOOTSTRAP_SOURCE);
  const result = reconcileDeploymentMetadata(LIVE_METADATA, reviewed, FIRST_BOOTSTRAP_SOURCE);
  assert.equal(result.status, "metadata_handoff_required");
  assert.match(result.patch.unifiedDiff, /proj_live/);
  assert.match(result.patch.unifiedDiff, /identity_live_staging/);
  assert.doesNotMatch(result.patch.unifiedDiff, /cloudflare_api_token\n\+/);
});

test("non-placeholder reviewed drift remains a hard reconciliation failure", () => {
  const reviewed = parsePleominoReviewedMetadata(
    FIRST_BOOTSTRAP_SOURCE.replace("proj_pleomino_deployments", "reviewed-live-project"),
  );
  assert.throws(
    () => reconcileDeploymentMetadata(LIVE_METADATA, reviewed, FIRST_BOOTSTRAP_SOURCE),
    /project id: live=proj_live reviewed=reviewed-live-project/,
  );
});

test("metadata patch changes only reviewed non-secret handoff constants", async () => {
  const reviewed = parsePleominoReviewedMetadata(FIRST_BOOTSTRAP_SOURCE);
  const patch = buildMetadataHandoffPatch(LIVE_METADATA, reviewed, FIRST_BOOTSTRAP_SOURCE);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-metadata-handoff-"));
  patch.path = path.join(dir, "family.bzl");
  await fs.writeFile(patch.path, FIRST_BOOTSTRAP_SOURCE);
  await applyMetadataHandoffPatch(patch);
  const applied = await fs.readFile(patch.path, "utf8");
  assert.match(applied, /_INFISICAL_PROJECT_ID = "proj_live"/);
  assert.match(applied, /"staging": "identity_live_staging"/);
  assert.match(applied, /"client_id": "pleomino-staging-client-id"/);
  assert.match(applied, /secret:\/\/deployments\/pleomino\/staging\/infisical-client-id/);
  assert.match(applied, /_INFISICAL_PROJECT_SLUG = "pleomino-deployments"/);
  assert.match(applied, /_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"/);
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

const FIRST_BOOTSTRAP_SOURCE = `
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "proj_pleomino_deployments"
_INFISICAL_PROJECT_NAME = "pleomino-deployments"
_INFISICAL_PROJECT_SLUG = "pleomino-deployments"
_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging"}
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "identity_pleomino_staging_deploy"}
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
