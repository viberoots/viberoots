#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";
import { InfisicalApi } from "../../deployments/infisical-iac-bootstrap-api";
import { buildDryRunReport } from "../../deployments/infisical-iac-bootstrap-dry-run";
import { buildCredentialHandoffReport } from "../../deployments/infisical-iac-bootstrap-handoff";
import { canonicalInfisicalApiUrl } from "../../deployments/infisical-iac-bootstrap-config";
import {
  parsePleominoReviewedMetadata,
  PLEOMINO_REVIEWED_METADATA_PATH,
  readPleominoReviewedMetadata,
} from "../../deployments/infisical-iac-bootstrap-reviewed-metadata";
import { reconcileDeploymentMetadata } from "../../deployments/infisical-iac-bootstrap-reconcile";
import { errorMessage } from "../../deployments/infisical-iac-bootstrap-redaction";

test("reconciliation accepts checked-in reviewed non-secret OpenTofu outputs", async () => {
  const reviewed = await readPleominoReviewedMetadata();
  const result = reconcileDeploymentMetadata(reviewed, reviewed);
  assert.equal(result.status, "ok");
});

test("reviewed metadata is parsed from the checked-in Pleomino source of truth", async () => {
  const source = await fs.readFile(PLEOMINO_REVIEWED_METADATA_PATH, "utf8");
  const reviewed = parsePleominoReviewedMetadata(source);
  assert.equal(
    reviewed.siteUrl,
    canonicalInfisicalApiUrl(stringConstant(source, "_INFISICAL_SITE_URL")),
  );
  assert.equal(reviewed.projectId, stringConstant(source, "_INFISICAL_PROJECT_ID"));
  assert.equal(reviewed.projectName, stringConstant(source, "_INFISICAL_PROJECT_NAME"));
  assert.equal(reviewed.projectSlug, stringConstant(source, "_INFISICAL_PROJECT_SLUG"));
  assert.equal(reviewed.secretPath, stringConstant(source, "_INFISICAL_SECRET_PATH"));
  assert.equal(
    reviewed.cloudflareSecretName,
    stringConstant(source, "_INFISICAL_CLOUDFLARE_SECRET_NAME"),
  );
  for (const item of reviewed.deploymentCredentials) {
    assert.equal(
      source.includes(`"${item.stage}": "${reviewed.environments[item.stage].slug}"`),
      true,
    );
    assert.equal(source.includes(`"${item.stage}": "${item.identityId}"`), true);
    assert.equal(source.includes(`"${item.stage}": "${item.identityName}"`), true);
    assert.equal(source.includes(`"client_id": "${item.clientIdRef}"`), true);
    assert.equal(source.includes(`"client_secret": "${item.clientSecretRef}"`), true);
    assert.equal(source.includes(`"client_id": "${item.clientIdFileName}"`), true);
    assert.equal(source.includes(`"client_secret": "${item.clientSecretFileName}"`), true);
  }
});

test("parser reflects checked-in reviewed input drift instead of a duplicate copy", async () => {
  const source = await fs.readFile(PLEOMINO_REVIEWED_METADATA_PATH, "utf8");
  const changedProject = source.replace(
    /_INFISICAL_SITE_URL = "[^"]+"/,
    '_INFISICAL_SITE_URL = "https://drifted.infisical.example"',
  );
  assert.equal(
    parsePleominoReviewedMetadata(changedProject).siteUrl,
    "https://drifted.infisical.example",
  );
  const changedProjectId = source.replace(
    /_INFISICAL_PROJECT_ID = "[^"]+"/,
    '_INFISICAL_PROJECT_ID = "proj_drifted"',
  );
  assert.equal(parsePleominoReviewedMetadata(changedProjectId).projectId, "proj_drifted");
  const changedSlug = source.replace(
    /_INFISICAL_PROJECT_SLUG = "[^"]+"/,
    '_INFISICAL_PROJECT_SLUG = "slug-drifted"',
  );
  assert.equal(parsePleominoReviewedMetadata(changedSlug).projectSlug, "slug-drifted");
  const changedRef = source.replace(
    "secret://deployments/pleomino/staging/infisical-client-id",
    "secret://deployments/pleomino/staging/drifted-client-id",
  );
  assert.equal(
    parsePleominoReviewedMetadata(changedRef).deploymentCredentials[0]?.clientIdRef,
    "secret://deployments/pleomino/staging/drifted-client-id",
  );
});

test("reconciliation mismatch fails with non-secret patch guidance", async () => {
  const reviewed = await readPleominoReviewedMetadata();
  assert.equal(
    reconcileDeploymentMetadata({ ...reviewed, siteUrl: `${reviewed.siteUrl}/api/` }, reviewed)
      .status,
    "ok",
  );
  assert.throws(
    () => reconcileDeploymentMetadata({ ...reviewed, siteUrl: "https://wrong.example" }, reviewed),
    /site url: live=https:\/\/wrong\.example reviewed=https:\/\/us\.infisical\.com[\s\S]*projects\/deployments\/pleomino-shared\/family\.bzl/,
  );
});

test("redaction removes human tokens and generated client secrets from errors", () => {
  const message = errorMessage(new Error("failed with human-token and generated-secret"), [
    "human-token",
    "generated-secret",
  ]);
  assert.equal(message.includes("human-token"), false);
  assert.equal(message.includes("generated-secret"), false);
  assert.match(message, /\[REDACTED\]/);
});

test("Infisical API errors redact response-body tokens and secret values", async () => {
  const api = new InfisicalApi({
    apiUrl: "https://infisical.example",
    token: "human-token",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          accessToken: "access-token",
          clientSecret: "generated-secret",
          secretValue: "secret-value",
          message: "failed human-token",
        }),
        { status: 500 },
      ),
  });
  await assert.rejects(
    () => api.request("GET", "/api/test"),
    (error) => {
      const message = String((error as Error).message);
      for (const leaked of ["human-token", "access-token", "generated-secret", "secret-value"]) {
        assert.equal(message.includes(leaked), false, `leaked ${leaked}`);
      }
      assert.match(message, /\[REDACTED\]/);
      return true;
    },
  );
});

test("credential handoff report emits stable refs without secret values", () => {
  const metadata = parsePleominoReviewedMetadata(CHECKED_IN_METADATA_FIXTURE);
  const report = buildCredentialHandoffReport({
    args: REVIEWED_ARGS,
    sinkDescription: "local secure sink .local/infisical-bootstrap-credentials.json",
    bootstrapIdentity: { id: "identity_bootstrap", name: "viberoots-iac-bootstrap" },
    metadata,
  });
  const text = JSON.stringify(report);
  assert.match(text, /secret:\/\/deployments\/pleomino\/staging\/infisical-client-secret/);
  assert.match(text, /handoff-only/);
  assert.match(text, /deployment credential lifecycle migration/);
  assert.match(text, /SprinkleRef resolver category support/);
  assert.doesNotMatch(text, /generated-secret|access-token|human-token/);
});

test("dry-run report omits access tokens and generated secret values", () => {
  const text = JSON.stringify(buildDryRunReport(REVIEWED_ARGS));
  assert.match(text, /infisical-iac-bootstrap-operations@1/);
  assert.doesNotMatch(text, /INFISICAL_ACCESS_TOKEN|generated-secret|access-token|clientSecret/);
});

const REVIEWED_ARGS = {
  apiUrl: "https://us.infisical.com",
  cliDomain: "https://us.infisical.com/api",
  identityName: "viberoots-iac-bootstrap",
  orgRole: "admin" as const,
  accessTokenEnv: "INFISICAL_ACCESS_TOKEN",
  infisicalBin: "infisical",
  noLogin: false,
  forceLogin: false,
  yes: true,
  dryRun: false,
  tofuDir: "projects/deployments/pleomino-infisical/opentofu",
  noTofuApply: false,
  rotateBootstrapCredentials: false,
  forceOverwriteLocalCredentials: false,
  credentialSink: "local-file" as const,
  localCredentialFile: ".local/infisical-bootstrap-credentials.json",
  sprinkleCategory: "bootstrap",
  clientSecretTtl: 0,
  accessTokenTtl: 3600,
};

function stringConstant(source: string, name: string) {
  return source.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`))?.[1];
}

const CHECKED_IN_METADATA_FIXTURE = `
_INFISICAL_PROJECT_ID = "proj_fixture"
_INFISICAL_SITE_URL = "https://us.infisical.com"
_INFISICAL_PROJECT_NAME = "pleomino-deployments"
_INFISICAL_PROJECT_SLUG = "pleomino-deployments"
_INFISICAL_ENVIRONMENT_SLUGS = {
    "staging": "staging",
}
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_MACHINE_IDENTITY_IDS = {
    "staging": "identity_fixture_staging",
}
_INFISICAL_MACHINE_IDENTITY_NAMES = {
    "staging": "pleomino-staging-deploy",
}
_INFISICAL_CREDENTIAL_FILE_NAMES = {
    "staging": {
        "client_id": "fixture-client-id",
        "client_secret": "fixture-client-secret",
    },
}
_INFISICAL_CREDENTIAL_REFS = {
    "staging": {
        "client_id": "secret://deployments/pleomino/staging/infisical-client-id",
        "client_secret": "secret://deployments/pleomino/staging/infisical-client-secret",
    },
}
`;
