#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import {
  buildDeploymentAuthDoctor,
  buildDeploymentAuthLoginInstructions,
  buildDeploymentVaultRoleExplanation,
} from "../../deployments/deployment-auth-diagnostics.ts";
import { deploymentAuthFailureDiagnostic } from "../../deployments/deployment-auth-failure-diagnostics.ts";
import {
  DEPLOYMENT_AUTH_REDACTION,
  redactDeploymentAuthJson,
  redactDeploymentAuthText,
} from "../../deployments/deployment-auth-redaction.ts";
import { renderDeploymentJenkinsHelp } from "../../deployments/deployment-auth-matrix.ts";
import { resolveDeploymentVaultRuntimePlan } from "../../deployments/deployment-vault-runtime-plan.ts";

const DEPLOYMENT = "//projects/deployments/pleomino-staging:deploy";

async function fixtureDeployment() {
  return await resolveDeploymentFromTarget(process.cwd(), DEPLOYMENT);
}

test("auth doctor reports source selection and missing Jenkins binding without minting", async () => {
  const deployment = await fixtureDeployment();
  const doctor = buildDeploymentAuthDoctor(deployment, {
    CI: "true",
    JENKINS_URL: "https://jenkins.example",
  });
  assert.equal(doctor.schemaVersion, "deployment-auth-doctor@1");
  assert.equal(doctor.readOnly, true);
  assert.equal(doctor.providerMutation, false);
  assert.equal(doctor.tokensMinted, false);
  assert.equal(doctor.credentialSource.source, "jenkins_client_secret");
  assert.match(doctor.vaultRuntime.credentialInputMissing.join("\n"), /BNX_DEPLOYER_CLIENT_SECRET/);
});

test("auth doctor fails closed for unsupported CI without interactive auth", async () => {
  const deployment = await fixtureDeployment();
  const doctor = buildDeploymentAuthDoctor(deployment, { CI: "true" });
  assert.match(doctor.credentialSource.error, /non-interactive credential source/);
  assert.equal(doctor.secretValuesRead, false);
});

test("vault role explanation exposes routing metadata without secret material", async () => {
  const deployment = await fixtureDeployment();
  const explanation = buildDeploymentVaultRoleExplanation(deployment);
  assert.equal(explanation.schemaVersion, "deployment-auth-vault-role@1");
  assert.equal(explanation.vault.expectedAudience, "deployments-vault");
  assert.equal(explanation.vault.roleName, "deploy-pleomino-read");
  assert.deepEqual(explanation.vault.boundClaimKeys, ["deployment_environment", "repository"]);
  assert.doesNotMatch(JSON.stringify(explanation), /access_token|refresh_token|client_secret/i);
});

test("print-login instructions are browserless and memory-only", async () => {
  const deployment = await fixtureDeployment();
  const login = buildDeploymentAuthLoginInstructions(deployment, { SSH_TTY: "/dev/pts/1" });
  assert.equal(login.browserLaunched, false);
  assert.equal(login.tokensMinted, false);
  assert.equal(login.sessionPolicy.persistentCache, false);
  assert.match(login.instructions.join("\n"), /--login-browser=print/);
});

test("Jenkins help and matrix share the reviewed credential env names", async () => {
  const deployment = await fixtureDeployment();
  const plan = resolveDeploymentVaultRuntimePlan({ deployment });
  const help = renderDeploymentJenkinsHelp(plan);
  assert.match(help, /BNX_DEPLOYER_CLIENT_SECRET/);
  assert.match(help, /withCredentials/);
  assert.doesNotMatch(help, /secret-value/);
});

test("auth docs advertise the same diagnostic command and Jenkins source names", async () => {
  const docs = await Promise.all(
    [
      "docs/secrets-usage.md",
      "docs/deployment-secrets-api.md",
      "docs/vault-production-bootstrap.md",
    ].map((file) => fsp.readFile(file, "utf8")),
  );
  const combined = docs.join("\n");
  assert.match(combined, /deploy auth doctor --deployment/);
  assert.match(combined, /deploy auth print-jenkins-help/);
  assert.match(combined, /jenkins_client_secret/);
  assert.match(combined, /external_oidc_token/);
});

test("auth redaction covers tokens, codes, URLs, JSON fields, and bound Jenkins values", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXBsb3kifQ.signature";
  const text = [
    `Authorization: Bearer ${jwt}`,
    "https://idp.example/callback?code=auth-code&code_verifier=pkce-verifier",
    '{"client_secret":"jenkins-secret","vault_token":"hvs.abcdefghijklmnop"}',
  ].join("\n");
  const redacted = redactDeploymentAuthText(text, { secrets: ["jenkins-secret"] });
  assert.doesNotMatch(redacted, /auth-code|pkce-verifier|jenkins-secret|eyJ|hvs\./);
  assert.ok(redacted.includes(DEPLOYMENT_AUTH_REDACTION));
  const payload = redactDeploymentAuthJson({ url: text, nested: [jwt] });
  assert.doesNotMatch(JSON.stringify(payload), /eyJ/);
});

test("auth failure diagnostics classify IdP, Vault, Jenkins, and CI failures", () => {
  assert.equal(
    deploymentAuthFailureDiagnostic(new Error("OIDC discovery issuer mismatch")).category,
    "idp_issuer_mismatch",
  );
  assert.equal(
    deploymentAuthFailureDiagnostic(new Error("Vault JWT login rejected: audience mismatch"))
      .category,
    "vault_jwt_rejected",
  );
  assert.equal(
    deploymentAuthFailureDiagnostic(new Error("permission denied reading secret/data/demo"))
      .category,
    "vault_policy_denied",
  );
  assert.equal(
    deploymentAuthFailureDiagnostic(new Error("Jenkins client-secret credential is unset"))
      .category,
    "jenkins_binding_missing",
  );
  assert.equal(
    deploymentAuthFailureDiagnostic(
      new Error("CI deployment requires a non-interactive credential source"),
    ).category,
    "ci_interactive_source",
  );
});
