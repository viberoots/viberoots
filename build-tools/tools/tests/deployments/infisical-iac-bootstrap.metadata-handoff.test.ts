#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  applyMetadataHandoffPatch,
  buildMetadataHandoffPatch,
} from "../../deployments/infisical-iac-bootstrap-metadata-handoff";
import { parseDeploymentReviewedContextConfig } from "../../deployments/infisical-iac-bootstrap-reviewed-metadata";
import { REVIEWED_CONTEXT_CONFIG_PATH } from "../../deployments/infisical-iac-bootstrap-config";
import { reconcileDeploymentMetadata } from "../../deployments/infisical-iac-bootstrap-reconcile";

test("placeholder context metadata becomes a first-bootstrap handoff patch", () => {
  const reviewed = parseDeploymentReviewedContextConfig(FIRST_BOOTSTRAP_SOURCE, "pleomino");
  const result = reconcileDeploymentMetadata(LIVE_METADATA, reviewed, FIRST_BOOTSTRAP_SOURCE);
  assert.equal(result.status, "metadata_handoff_required");
  assert.equal(result.patch.path, REVIEWED_CONTEXT_CONFIG_PATH);
  assert.match(result.patch.unifiedDiff, /proj_live/);
  assert.match(result.patch.unifiedDiff, /identity_live_staging/);
  assert.doesNotMatch(result.patch.unifiedDiff, /cloudflare_api_token\n\+/);
});

test("missing live reviewed ids fail closed instead of partial handoff", () => {
  const reviewed = parseDeploymentReviewedContextConfig(FIRST_BOOTSTRAP_SOURCE, "pleomino");
  assert.throws(
    () =>
      reconcileDeploymentMetadata(
        { ...LIVE_METADATA, projectId: undefined },
        reviewed,
        FIRST_BOOTSTRAP_SOURCE,
      ),
    /project id: live=<missing> reviewed=proj_pleomino_deployments/,
  );
  assert.throws(
    () =>
      reconcileDeploymentMetadata(
        {
          ...LIVE_METADATA,
          deploymentCredentials: [
            { ...LIVE_METADATA.deploymentCredentials[0]!, identityId: "" },
            LIVE_METADATA.deploymentCredentials[1]!,
          ],
        },
        reviewed,
        FIRST_BOOTSTRAP_SOURCE,
      ),
    /staging identity id: live=<missing> reviewed=identity_pleomino_staging_deploy/,
  );
});

test("empty reviewed host requires live output before handoff", () => {
  const source = FIRST_BOOTSTRAP_SOURCE.replaceAll(
    '"host": "https://app.infisical.com"',
    '"host": ""',
  );
  const reviewed = parseDeploymentReviewedContextConfig(source, "pleomino");
  assert.throws(
    () => reconcileDeploymentMetadata({ ...LIVE_METADATA, siteUrl: undefined }, reviewed, source),
    /site url: live=<missing> reviewed=<missing>/,
  );
  const result = reconcileDeploymentMetadata(LIVE_METADATA, reviewed, source);
  assert.equal(result.status, "metadata_handoff_required");
  assert.match(result.patch.unifiedDiff, /"host": "https:\/\/app\.infisical\.com"/);
});

test("metadata patch rejects required replacements without live after values", () => {
  const reviewed = parseDeploymentReviewedContextConfig(FIRST_BOOTSTRAP_SOURCE, "pleomino");
  assert.throws(
    () =>
      buildMetadataHandoffPatch(
        { ...LIVE_METADATA, projectId: undefined },
        reviewed,
        FIRST_BOOTSTRAP_SOURCE,
      ),
    /metadata patch missing live value for deploymentContexts\.pleomino-staging\.infisical\.projectId/,
  );
});

test("non-placeholder reviewed drift remains a hard reconciliation failure", () => {
  const source = FIRST_BOOTSTRAP_SOURCE.replace("proj_pleomino_deployments", "reviewed-live");
  const reviewed = parseDeploymentReviewedContextConfig(source, "pleomino");
  assert.throws(
    () => reconcileDeploymentMetadata(LIVE_METADATA, reviewed, source),
    /project id: live=proj_live reviewed=reviewed-live/,
  );
});

test("metadata patch changes only reviewed non-secret context fields", async () => {
  const applied = JSON.parse(await applyPatchToTemp(FIRST_BOOTSTRAP_SOURCE));
  const infisical = applied.deploymentContexts["pleomino-staging"].infisical;
  assert.equal(infisical.projectId, "proj_live");
  assert.equal(infisical.machineIdentityId, "identity_live_staging");
  assert.equal(infisical.clientIdFileName, "pleomino-staging-infisical-client-id");
  assert.equal(
    infisical.clientSecretRef,
    "secret://deployments/pleomino/staging/infisical-client-secret",
  );
  assert.equal(
    applied.deploymentContexts["pleomino-staging"].cloudflare.apiTokenRef,
    "secret://deployments/pleomino/cloudflare_api_token",
  );
});

test("metadata patch fails closed when required context paths are missing", () => {
  const source = FIRST_BOOTSTRAP_SOURCE.replace('"projectId": "proj_pleomino_deployments",\n', "");
  assert.throws(() => buildPatch(source), /missing projectId in checked-in deployment metadata/);
});

test("metadata patch rejects unsupported reviewed paths", async () => {
  const patch = buildPatch(FIRST_BOOTSTRAP_SOURCE);
  patch.replacements = [
    { label: "deploymentContexts.pleomino-staging.missing.projectId", before: "old", after: "new" },
  ];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-metadata-handoff-"));
  patch.path = path.join(dir, "shared.json");
  await fs.writeFile(patch.path, FIRST_BOOTSTRAP_SOURCE);
  await assert.rejects(() => applyMetadataHandoffPatch(patch), /expected object at missing/);
});

async function applyPatchToTemp(source: string) {
  const patch = buildPatch(source);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-metadata-handoff-"));
  patch.path = path.join(dir, "shared.json");
  await fs.writeFile(patch.path, source);
  await applyMetadataHandoffPatch(patch);
  return await fs.readFile(patch.path, "utf8");
}

function buildPatch(source: string) {
  const reviewed = parseDeploymentReviewedContextConfig(source, "pleomino");
  return buildMetadataHandoffPatch(LIVE_METADATA, reviewed, source);
}

const LIVE_METADATA = {
  siteUrl: "https://app.infisical.com",
  projectName: "pleomino-deployments",
  projectId: "proj_live",
  projectSlug: "pleomino-deployments",
  secretPath: "/",
  cloudflareSecretName: "cloudflare_api_token",
  environments: { staging: { slug: "staging" }, prod: { slug: "prod" } },
  deploymentCredentials: [
    {
      stage: "staging",
      identityId: "identity_live_staging",
      identityName: "pleomino-staging-deploy",
      clientIdRef: "secret://deployments/pleomino/staging/infisical-client-id",
      clientSecretRef: "secret://deployments/pleomino/staging/infisical-client-secret",
      clientIdFileName: "pleomino-staging-infisical-client-id",
      clientSecretFileName: "pleomino-staging-infisical-client-secret",
    },
    {
      stage: "prod",
      identityId: "identity_live_prod",
      identityName: "pleomino-prod-deploy",
      clientIdRef: "secret://deployments/pleomino/prod/infisical-client-id",
      clientSecretRef: "secret://deployments/pleomino/prod/infisical-client-secret",
      clientIdFileName: "pleomino-prod-infisical-client-id",
      clientSecretFileName: "pleomino-prod-infisical-client-secret",
    },
  ],
};

const context = (stage: "staging" | "prod") => ({
  secretBackend: "infisical/default",
  infisical: {
    host: "https://app.infisical.com",
    projectId: "proj_pleomino_deployments",
    projectName: "pleomino-deployments",
    projectSlug: "pleomino-deployments",
    environment: stage,
    defaultPath: "/",
    machineIdentityId: `identity_pleomino_${stage}_deploy`,
    machineIdentityName: `pleomino-${stage}-deploy`,
    clientIdRef: `secret://deployments/pleomino/${stage}/infisical-client-id`,
    clientSecretRef: `secret://deployments/pleomino/${stage}/infisical-client-secret`,
    clientIdFileName: "",
    clientSecretFileName: "",
  },
  cloudflare: {
    apiTokenRef: "secret://deployments/pleomino/cloudflare_api_token",
  },
});

const FIRST_BOOTSTRAP_SOURCE = `${JSON.stringify(
  {
    schemaVersion: "viberoots-project-config@1",
    deploymentContexts: {
      "pleomino-staging": context("staging"),
      "pleomino-prod": context("prod"),
    },
  },
  null,
  2,
)}\n`;
