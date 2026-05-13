#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/cloudflare-pages-control-plane-api-contract";
import {
  assertNoProtectedSharedClientCredentialInputs,
  assertNoProtectedSharedClientIdentityFields,
} from "../../deployments/deployment-service-client-contract";
import { runInTemp } from "../lib/test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { startControlPlaneHarness } from "./nixos-shared-host.control-plane.helpers";

test("cloudflare-pages service rejects laptop-local artifactDir submissions", async () => {
  await runInTemp("cloudflare-pages-service-rejects-artifact-dir", async (tmp) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    });
    try {
      const response = await fetch(new URL("/api/v1/submissions", harness.controlPlane.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
          submissionId: "submission-local-artifact-dir",
          submittedAt: new Date().toISOString(),
          deployment,
          operationKind: "deploy",
          artifactDir: "/tmp/laptop/dist",
        }),
      });
      assert.equal(response.ok, false);
      assert.match(await response.text(), /protected\/shared submissions must use artifactInput/);
    } finally {
      await harness.close();
    }
  });
});

test("cloudflare-pages service rejects client-supplied identity fields", async () => {
  await runInTemp("cloudflare-pages-service-rejects-client-identity", async (tmp) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    });
    try {
      const response = await fetch(new URL("/api/v1/submissions", harness.controlPlane.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
          submissionId: "submission-forged-identity",
          submittedAt: new Date().toISOString(),
          deployment,
          operationKind: "deploy",
          requestedBy: { principalId: "user:forged" },
        }),
      });
      assert.equal(response.status, 403);
      assert.match(await response.text(), /client-supplied requestedBy/);
    } finally {
      await harness.close();
    }
  });
});

test("protected service client rejects laptop Vault and fixture credential inputs", () => {
  const deployment = cloudflarePagesDeploymentFixture();
  assert.throws(
    () =>
      assertNoProtectedSharedClientCredentialInputs({
        deployment,
        publicFrontDoor: true,
        env: { VBR_DEPLOYMENT_SECRET_FIXTURE_PATH: "/tmp/fixture.json" },
      }),
    /must not use laptop credential input VBR_DEPLOYMENT_SECRET_FIXTURE_PATH/,
  );
  assert.throws(
    () =>
      assertNoProtectedSharedClientCredentialInputs({
        deployment,
        publicFrontDoor: true,
        env: { INFISICAL_ACCESS_TOKEN: "client-token" },
      }),
    /must not use laptop credential input INFISICAL_ACCESS_TOKEN/,
  );
  assert.throws(
    () =>
      assertNoProtectedSharedClientCredentialInputs({
        deployment,
        publicFrontDoor: true,
        env: { INFISICAL_PERSONAL_TOKEN: "personal-token" },
      }),
    /must not use laptop credential input INFISICAL_PERSONAL_TOKEN/,
  );
  assert.throws(
    () =>
      assertNoProtectedSharedClientCredentialInputs({
        deployment,
        publicFrontDoor: true,
        vaultRuntimeInputs: { credentialSource: "external_oidc_token" },
        env: {},
      }),
    /must not use client-side Vault credential source external_oidc_token/,
  );
});

test("protected service client rejects submitted Infisical credential fields", () => {
  const deployment = cloudflarePagesDeploymentFixture();
  assert.throws(
    () =>
      assertNoProtectedSharedClientIdentityFields({
        deployment,
        request: { infisicalAccessToken: "client-token" },
      }),
    /client-submitted Infisical credential field infisicalAccessToken/,
  );
  assert.throws(
    () =>
      assertNoProtectedSharedClientIdentityFields({
        deployment,
        request: { credential: { secretValue: "secret-value" } },
      }),
    /client-submitted Infisical credential field credential.secretValue/,
  );
});
