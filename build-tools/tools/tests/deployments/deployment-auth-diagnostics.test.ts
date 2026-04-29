#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import {
  buildDeploymentAuthActionSummary,
  buildDeploymentAuthGroupSummary,
  buildDeploymentAuthKeycloakRealm,
} from "../../deployments/deployment-auth-readonly.ts";
import {
  buildDeploymentAuthDoctor as buildDoctor,
  buildDeploymentAuthLoginInstructions as buildLoginInstructions,
  buildDeploymentVaultRoleExplanation as buildVaultRole,
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
  const doctor = buildDoctor(deployment, {
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
  const doctor = buildDoctor(deployment, { CI: "true" });
  assert.match(doctor.credentialSource.error, /non-interactive credential source/);
  assert.equal(doctor.secretValuesRead, false);
});

test("vault role explanation exposes routing metadata without secret material", async () => {
  const deployment = await fixtureDeployment();
  const explanation = buildVaultRole(deployment);
  assert.equal(explanation.schemaVersion, "deployment-auth-vault-role@1");
  assert.equal(explanation.vault.expectedAudience, "deployments-vault");
  assert.equal(explanation.vault.roleName, "deploy-pleomino-read");
  assert.deepEqual(explanation.vault.boundClaimKeys, ["deployment_environment", "repository"]);
  assert.doesNotMatch(JSON.stringify(explanation), /access_token|refresh_token|client_secret/i);
});

test("print-login instructions are browserless and memory-only", async () => {
  const deployment = await fixtureDeployment();
  const login = buildLoginInstructions(deployment, { SSH_TTY: "/dev/pts/1" });
  assert.equal(login.browserLaunched, false);
  assert.equal(login.tokensMinted, false);
  assert.equal(login.sessionPolicy.persistentCache, false);
  assert.equal(login.pkceCallback.mode, "public_host");
  assert.equal(login.pkceCallback.externalHost, "deploy-auth.apps.kilty.io");
  assert.equal(login.pkceCallback.bindPort, 7780);
  assert.match(login.instructions.join("\n"), /--login-browser=print/);
});

test("auth doctor lets CLI/env callback profile overrides win over metadata", async () => {
  const deployment = await fixtureDeployment();
  const doctor = buildDoctor(deployment, {
    BNX_DEPLOYMENT_PKCE_CALLBACK_MODE: "public_host",
    BNX_DEPLOYMENT_PKCE_CALLBACK_EXTERNAL_SCHEME: "http",
    BNX_DEPLOYMENT_PKCE_CALLBACK_HOST: "override.example.test",
    BNX_DEPLOYMENT_PKCE_CALLBACK_EXTERNAL_PORT: "8088",
    BNX_DEPLOYMENT_PKCE_CALLBACK_BIND_HOST: "127.0.0.1",
    BNX_DEPLOYMENT_PKCE_CALLBACK_BIND_PORT: "18088",
  });
  assert.equal(doctor.vaultRuntime.pkceCallback.externalScheme, "http");
  assert.equal(doctor.vaultRuntime.pkceCallback.externalHost, "override.example.test");
  assert.equal(doctor.vaultRuntime.pkceCallback.externalPort, 8088);
  assert.equal(doctor.vaultRuntime.pkceCallback.bindPort, 18088);
});

test("Jenkins help and matrix share the reviewed credential env names", async () => {
  const deployment = await fixtureDeployment();
  const plan = resolveDeploymentVaultRuntimePlan({ deployment });
  const help = renderDeploymentJenkinsHelp(plan);
  assert.match(help, /BNX_DEPLOYER_CLIENT_SECRET/);
  assert.match(help, /withCredentials/);
  assert.doesNotMatch(help, /secret-value/);
});

test("auth group summary prints reviewed human groups and automation patterns", async () => {
  const deployment = await fixtureDeployment();
  const groups = buildDeploymentAuthGroupSummary(deployment, ["jenkins"]);
  assert.equal(groups.schemaVersion, "deployment-auth-groups@1");
  assert.deepEqual(groups.humanGroups, [
    "deploy-submitters-pleomino-staging",
    "deploy-approvers-pleomino-staging",
    "deploy-admission-reporters-pleomino-staging",
  ]);
  assert.match(groups.automationGroupPatterns.join("\n"), /deploy-automation-<principal>/);
  assert.deepEqual(groups.automationGroupsByPrincipal[0]?.groups.slice(0, 2), [
    "deploy-automation-jenkins-submitters-project-pleomino",
    "deploy-automation-jenkins-approvers-project-pleomino",
  ]);
});

test("auth action summary and realm export stay aligned on reviewed group names", async () => {
  const deployment = await fixtureDeployment();
  const action = buildDeploymentAuthActionSummary(deployment, "approve", ["jenkins"]);
  const realm = buildDeploymentAuthKeycloakRealm([deployment], ["jenkins"]);
  assert.equal(action.requiredRole, "approver");
  assert.equal(action.humanGroup, "deploy-approvers-pleomino-staging");
  assert.match(action.nextStep, /deploy auth explain-groups/);
  assert.deepEqual(realm.groups.map((group) => group.name).slice(0, 4), [
    "deploy-admission-reporters-pleomino-staging",
    "deploy-approvers-pleomino-staging",
    "deploy-automation-jenkins-admission-reporters-all-deployments",
    "deploy-automation-jenkins-admission-reporters-project-pleomino",
  ]);
  assert.equal(realm.clients[0]?.clientId, "deployment-cli");
  assert.deepEqual(
    realm.clients[0]?.protocolMappers.map((mapper) => mapper.name),
    ["groups", "email", "audience", "deployment_environment", "repository"],
  );
  assert.equal(realm.clients[0]?.protocolMappers[0]?.config["claim.name"], "groups");
  assert.equal(realm.clients[0]?.protocolMappers[1]?.config["claim.name"], "email");
  assert.equal(
    realm.clients[0]?.protocolMappers[2]?.config["included.custom.audience"],
    "deployments-vault",
  );
  assert.equal(realm.clients[0]?.protocolMappers[3]?.config["claim.value"], "mini");
  assert.equal(realm.clients[0]?.protocolMappers[4]?.config["claim.value"], "kiltyj/bucknix-fresh");
  const commands = action.exampleAdminCommands.join("\n");
  assert.match(
    commands,
    /deploy admin identity grant-user --deployment .* --profile mini --action approve --apply-host/i,
  );
  assert.match(
    commands,
    /deploy admin identity grant-user --deployment .* --profile mini --action approve --user-email <user@example\.com> --apply-host/i,
  );
  assert.doesNotMatch(commands, /--membership-file/i);
  assert.doesNotMatch(commands, /--acting-principal/i);
  assert.doesNotMatch(commands, /--admin-group/i);
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
