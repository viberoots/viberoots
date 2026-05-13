#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeCredentialSource,
  normalizeSecretCredentialSource,
  selectDeploymentCredentialSource,
  vaultSecretCredentialSource,
} from "../../deployments/deployment-credential-source-selection";

test("local desktop sessions choose browser-capable PKCE by default", () => {
  const selected = selectDeploymentCredentialSource({
    env: { TERM_PROGRAM: "Apple_Terminal" },
  });
  assert.equal(selected.source, "interactive_pkce");
});

test("SSH or headless sessions avoid browser launch", () => {
  assert.equal(
    selectDeploymentCredentialSource({
      env: { SSH_CONNECTION: "client server", SSH_TTY: "/dev/pts/1" },
      deviceAuthorizationSupported: true,
    }).source,
    "interactive_device",
  );
  assert.equal(
    selectDeploymentCredentialSource({
      env: { SSH_TTY: "/dev/pts/1" },
      deviceAuthorizationSupported: false,
    }).source,
    "interactive_print_url",
  );
});

test("CI sessions require a configured non-interactive source", () => {
  assert.throws(
    () => selectDeploymentCredentialSource({ env: { CI: "true" } }),
    /non-interactive credential source/,
  );
  assert.equal(
    selectDeploymentCredentialSource({
      env: { CI: "true", JENKINS_URL: "https://jenkins.example" },
      preferred: "jenkins_client_secret",
    }).source,
    "jenkins_client_secret",
  );
});

test("explicit login-browser and credential-source overrides are deterministic", () => {
  assert.equal(
    selectDeploymentCredentialSource({
      loginBrowser: "print",
      preferred: "interactive_pkce",
      env: { CI: "true" },
    }).source,
    "interactive_print_url",
  );
  assert.equal(normalizeCredentialSource("external_oidc_token"), "external_oidc_token");
  assert.throws(() => normalizeCredentialSource("ambient_env"), /must be one of/);
});

test("Infisical selection uses backend-qualified Universal Auth source", () => {
  assert.equal(
    selectDeploymentCredentialSource({
      secretBackend: "infisical",
      env: { CI: "true" },
    }).source,
    "infisical_machine_identity_universal_auth",
  );
  assert.equal(
    selectDeploymentCredentialSource({
      secretBackend: "infisical",
      preferred: "infisical_machine_identity_universal_auth",
    }).reason,
    "infisical_runtime preferred source",
  );
  assert.equal(vaultSecretCredentialSource("jenkins_client_secret"), "vault_jenkins_client_secret");
  assert.equal(
    normalizeSecretCredentialSource("infisical_machine_identity_universal_auth"),
    "infisical_machine_identity_universal_auth",
  );
  assert.throws(
    () =>
      selectDeploymentCredentialSource({
        preferred: "infisical_machine_identity_universal_auth",
      }),
    /requires secret_backend infisical/,
  );
  assert.throws(
    () =>
      selectDeploymentCredentialSource({
        secretBackend: "infisical",
        preferred: "jenkins_client_secret",
      }),
    /require credential source infisical_machine_identity_universal_auth/,
  );
});
