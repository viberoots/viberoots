#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";
import { parseBootstrapArgs, usage } from "../../deployments/infisical-iac-bootstrap-args";
import {
  DEFAULT_BOOTSTRAP_ARGS,
  defaultBootstrapKeychainServiceName,
  defaultRepoKeychainServiceName,
  defaultRepoInfisicalProjectName,
  withRepoInfisicalProjectName,
} from "../../deployments/infisical-iac-bootstrap-config";
import { runInfisicalBootstrapMain } from "../../deployments/infisical-iac-bootstrap";

test("bootstrap args require an explicit mode", () => {
  assert.throws(() => parseBootstrapArgs([]), /use exactly one bootstrap mode/);
});

test("bootstrap usage prints the selected operator command surface", () => {
  const text = usage();
  assert.match(text, /build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo --dry-run/);
  assert.match(text, /build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo --yes/);
  assert.match(
    text,
    /build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo --without-deployments/,
  );
  assert.match(text, /--apply-metadata-patch/);
  assert.match(
    text,
    /build-tools\/tools\/deployments\/infisical-bootstrap\.ts deployment --target <buck-target> --dry-run/,
  );
  assert.match(
    text,
    /build-tools\/tools\/deployments\/infisical-bootstrap\.ts deployment --target <buck-target> --yes/,
  );
  assert.doesNotMatch(text, /infisical-iac-bootstrap\.ts/);
});

test("bootstrap main help prints usage before required mode parsing", async () => {
  for (const helpFlag of ["--help", "-h"]) {
    const output: string[] = [];
    await runInfisicalBootstrapMain({
      argv: [helpFlag],
      stdout: (text) => output.push(text),
      stderr: () => assert.fail("help must not print an error"),
      exit: () => assert.fail("help must not exit"),
    });
    const text = output.join("\n");
    assert.match(text, /build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo --dry-run/);
    assert.match(
      text,
      /build-tools\/tools\/deployments\/infisical-bootstrap\.ts deployment --target <buck-target> --yes/,
    );
    assert.doesNotMatch(text, /use exactly one bootstrap mode/);
  }
});

test("bootstrap entrypoint is executable as documented", async () => {
  const mode = (await fs.stat("viberoots/build-tools/tools/deployments/infisical-bootstrap.ts"))
    .mode;
  assert.notEqual(mode & 0o111, 0);
});

test("bootstrap repo args default to generic resolver setup", () => {
  const args = parseBootstrapArgs(["repo"]);
  assert.equal(args.apiUrl, "https://app.infisical.com");
  assert.equal(args.cliDomain, "https://app.infisical.com/api");
  assert.equal(args.noTofuApply, false);
  assert.equal(args.tofuDir, "");
  assert.equal(args.withoutDeployments, false);
});

test("bootstrap repo args support deployment fan-out opt-out", () => {
  assert.equal(parseBootstrapArgs(["repo", "--without-deployments"]).withoutDeployments, true);
});

test("default repo Infisical project name comes from consumer repo directory", () => {
  assert.equal(defaultRepoInfisicalProjectName("/tmp/unfairly-common"), "unfairly-common");
});

test("repo Infisical project name resolution marks generated defaults", async () => {
  const args = await withRepoInfisicalProjectName(DEFAULT_BOOTSTRAP_ARGS, "/tmp/unfairly-common");
  assert.equal(args.infisicalProjectName, "unfairly-common");
  assert.equal(args.infisicalProjectNameSource, "default");
});

test("repo Infisical project name resolution preserves explicit names", async () => {
  const args = await withRepoInfisicalProjectName(
    { ...DEFAULT_BOOTSTRAP_ARGS, infisicalProjectName: "shared-secrets" },
    "/tmp/unfairly-common",
  );
  assert.equal(args.infisicalProjectName, "shared-secrets");
  assert.equal(args.infisicalProjectNameSource, "explicit");
});

test("default Keychain service names come from consumer repo directory", () => {
  assert.equal(
    defaultBootstrapKeychainServiceName("/tmp/unfairly-common"),
    "unfairly-common-bootstrap",
  );
  assert.equal(defaultRepoKeychainServiceName("/tmp/unfairly-common"), "unfairly-common");
});

test("bootstrap deployment args default to reviewed OpenTofu setup", () => {
  const args = parseBootstrapArgs([
    "deployment",
    "--target",
    "//projects/deployments/sample-webapp/staging:deploy",
  ]);
  assert.equal(args.tofuDir, "projects/deployments/sample-webapp/infisical/opentofu");
});

test("bootstrap args support host shorthands and non-interactive controls", () => {
  const args = parseBootstrapArgs([
    "repo",
    "--infisical-host",
    "eu",
    "--login-mode",
    "interactive",
    "--no-login",
    "--access-token-env",
    "TOKEN_ENV",
    "--organization-id",
    "org_1",
    "--tofu-plan-file",
    ".local/plan.tfplan",
    "--no-tofu-apply",
    "--rotate-deployment-credentials",
    "--machine-label",
    "ci-builder-1",
    "--bootstrap-scope",
    "fixture-repo",
    "--infisical-project-name",
    "shared-repo-secrets",
    "--bootstrap-keychain-service-name",
    "shared-repo-bootstrap",
    "--keychain-service-name",
    "shared-repo-main",
    "--select-infisical-project",
    "--apply-metadata-patch",
    "--yes",
  ]);
  assert.equal(args.apiUrl, "https://eu.infisical.com");
  assert.equal(args.cliDomain, "https://eu.infisical.com/api");
  assert.equal(args.loginMode, "interactive");
  assert.equal(args.accessTokenEnv, "TOKEN_ENV");
  assert.equal(args.organizationId, "org_1");
  assert.equal(args.noTofuApply, true);
  assert.equal(args.rotateDeploymentCredentials, true);
  assert.equal(args.machineLabel, "ci-builder-1");
  assert.equal(args.bootstrapCredentialScope, "fixture-repo");
  assert.equal(args.infisicalProjectName, "shared-repo-secrets");
  assert.equal(args.selectInfisicalProject, true);
  assert.equal(args.bootstrapKeychainServiceName, "shared-repo-bootstrap");
  assert.equal(args.keychainServiceName, "shared-repo-main");
  assert.equal(args.applyMetadataPatch, true);
  assert.equal(args.yes, true);
});

test("bootstrap args reject invalid machine labels", () => {
  assert.throws(
    () => parseBootstrapArgs(["repo", "--machine-label", "bad\nlabel"]),
    /--machine-label must be 1-80 characters/,
  );
});

test("--no-login requires an explicit organization selector", () => {
  assert.throws(
    () => parseBootstrapArgs(["repo", "--no-login", "--yes"]),
    /--no-login requires exactly one organization selector[\s\S]*--org-name <name> or --organization-id <id>/,
  );
  assert.equal(
    parseBootstrapArgs(["repo", "--no-login", "--org-name", "viberoots"]).orgName,
    "viberoots",
  );
  assert.equal(
    parseBootstrapArgs(["repo", "--no-login", "--organization-id", "org_1"]).organizationId,
    "org_1",
  );
});

test("bootstrap args parse explicit repo and deployment modes", () => {
  assert.equal(parseBootstrapArgs(["repo", "--dry-run"]).mode, "repo");
  const deployment = parseBootstrapArgs([
    "deployment",
    "--target",
    "//projects/deployments/sample-webapp/staging:deploy",
    "--dry-run",
  ]);
  assert.equal(deployment.mode, "deployment");
  assert.equal(deployment.target, "//projects/deployments/sample-webapp/staging:deploy");
});

test("bootstrap args reject ambiguous organization selectors", () => {
  assert.throws(
    () => parseBootstrapArgs(["repo", "--organization-id", "org_1", "--org-name", "viberoots"]),
    /use only one/,
  );
});
