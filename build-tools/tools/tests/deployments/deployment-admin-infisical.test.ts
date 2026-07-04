#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDeploymentAdminInfisicalPlan } from "../../deployments/deployment-admin-infisical";
import { maybeHandleDeploymentAdminCli } from "../../deployments/deployment-admin-keycloak-cli";
import { maybeHandleDeploymentAuthCli } from "../../deployments/deployment-auth-diagnostics";
import {
  buildDeploymentInfisicalIdentityExplanation,
  buildDeploymentSecretBackendExplanation,
} from "../../deployments/deployment-auth-infisical-diagnostics";
import {
  captureDeployCli,
  INFISICAL_ADMIN_DEPLOYMENT,
  infisicalAdminDeployment,
  withDeployArgv,
} from "./deployment-admin-infisical.fixture";
import { infisicalRequirement } from "./deployment-secret-infisical.fixture";
import { runInTemp } from "../lib/test-helpers";
import { writeCloudflarePagesExtractionFixture } from "./cloudflare-pages.extraction.fixture";

test("Infisical auth diagnostics print only safe backend and identity routing", async () => {
  const deployment = await infisicalAdminDeployment();
  const backend = buildDeploymentSecretBackendExplanation(deployment);
  const identity = buildDeploymentInfisicalIdentityExplanation(deployment, {});
  assert.equal(backend.schemaVersion, "deployment-auth-secret-backend@1");
  assert.equal(backend.backendKind, "infisical");
  assert.equal(backend.contracts[0]?.contractId, infisicalRequirement.contractId);
  assert.equal(identity.schemaVersion, "deployment-auth-infisical-identity@1");
  assert.deepEqual(identity.missingEnvVarNames, ["INFISICAL_CLIENT_ID", "INFISICAL_CLIENT_SECRET"]);
  assert.doesNotMatch(
    JSON.stringify({ backend, identity }),
    /client-secret-leak-sentinel|access-token-leak-sentinel|Bearer/i,
  );
});

test("Infisical admin plan is local and read-only", async () => {
  const deployment = await infisicalAdminDeployment();
  const plan = buildDeploymentAdminInfisicalPlan(deployment, {});
  assert.equal(plan.schemaVersion, "deploy-admin-infisical-plan@1");
  assert.equal(plan.readOnly, true);
  assert.equal(plan.providerMutation, false);
  assert.equal(plan.secretValuesRead, false);
  assert.equal(plan.desiredSecrets[0]?.selector.secretName, "cloudflare_api_token");
  assert.deepEqual(plan.credentialSource.missingEnvVarNames, [
    "INFISICAL_CLIENT_ID",
    "INFISICAL_CLIENT_SECRET",
  ]);
});

test("deploy CLI groups expose Infisical auth and admin commands", async () => {
  await runInTemp("deployment-admin-infisical-cli", async (tmp) => {
    await writeCloudflarePagesExtractionFixture(tmp, { infisical: true });
    const auth = await withDeployArgv(
      ["auth", "explain-secret-backend", "--deployment", INFISICAL_ADMIN_DEPLOYMENT],
      async () => await captureDeployCli(() => maybeHandleDeploymentAuthCli(tmp)),
    );
    assert.equal(auth.schemaVersion, "deployment-auth-secret-backend@1");
    const identity = await withDeployArgv(
      ["auth", "explain-infisical-identity", "--deployment", INFISICAL_ADMIN_DEPLOYMENT],
      async () => await captureDeployCli(() => maybeHandleDeploymentAuthCli(tmp)),
    );
    assert.equal(identity.schemaVersion, "deployment-auth-infisical-identity@1");
    const admin = await withDeployArgv(
      ["admin", "infisical", "plan", "--deployment", INFISICAL_ADMIN_DEPLOYMENT],
      async () => await captureDeployCli(() => maybeHandleDeploymentAdminCli(tmp)),
    );
    assert.equal(admin.schemaVersion, "deploy-admin-infisical-plan@1");
    const check = await withDeployArgv(
      ["admin", "infisical", "check", "--deployment", INFISICAL_ADMIN_DEPLOYMENT],
      async () => await captureDeployCli(() => maybeHandleDeploymentAdminCli(tmp)),
    );
    assert.equal(check.schemaVersion, "deploy-admin-infisical-check@1");
    await withDeployArgv(
      ["admin", "infisical", "sync", "--deployment", INFISICAL_ADMIN_DEPLOYMENT],
      async () => {
        await assert.rejects(
          () => maybeHandleDeploymentAdminCli(tmp),
          /deploy admin infisical command must be one of plan, check/,
        );
        return {};
      },
    );
  });
});
