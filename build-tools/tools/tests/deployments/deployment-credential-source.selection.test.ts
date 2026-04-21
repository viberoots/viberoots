#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeCredentialSource,
  selectDeploymentCredentialSource,
} from "../../deployments/deployment-credential-source-selection.ts";

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
