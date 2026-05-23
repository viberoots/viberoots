#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { bootstrapRetryCommand } from "../../deployments/infisical-iac-bootstrap-preflight";

test("repo retry command preserves machine label with shell quoting", () => {
  const command = bootstrapRetryCommand({
    ...DEFAULT_BOOTSTRAP_ARGS,
    machineLabel: "Jay's laptop 1",
  });

  assert.match(command, /infisical-bootstrap\.ts repo /);
  assert.match(command, /--machine-label 'Jay'\\''s laptop 1'/);
  assert.match(command, /--yes$/);
});

test("repo retry command preserves credential rotation and overwrite intent", () => {
  const command = bootstrapRetryCommand({
    ...DEFAULT_BOOTSTRAP_ARGS,
    rotateBootstrapCredentials: true,
    rotateDeploymentCredentials: true,
    forceOverwriteLocalCredentials: true,
  });

  assert.match(command, /--rotate-bootstrap-credentials/);
  assert.match(command, /--rotate-deployment-credentials/);
  assert.match(command, /--force-overwrite-local-credentials/);
});

test("deployment retry command preserves target and credential intent", () => {
  const command = bootstrapRetryCommand({
    ...DEFAULT_BOOTSTRAP_ARGS,
    mode: "deployment",
    target: "//projects/deployments/pleomino/staging:deploy",
    machineLabel: "ci-builder",
    rotateDeploymentCredentials: true,
  });

  assert.match(
    command,
    /infisical-bootstrap\.ts deployment --target \/\/projects\/deployments\/pleomino\/staging:deploy /,
  );
  assert.match(command, /--machine-label ci-builder/);
  assert.match(command, /--rotate-deployment-credentials/);
  assert.match(command, /--yes$/);
});

test("retry command omits overwrite intent when it was not supplied", () => {
  const command = bootstrapRetryCommand({
    ...DEFAULT_BOOTSTRAP_ARGS,
    rotateBootstrapCredentials: true,
  });

  assert.match(command, /--rotate-bootstrap-credentials/);
  assert.doesNotMatch(command, /--force-overwrite-local-credentials/);
});

test("retry command does not copy dry-run-only or unrelated flags", () => {
  const command = bootstrapRetryCommand({
    ...DEFAULT_BOOTSTRAP_ARGS,
    dryRun: true,
    withoutDeployments: true,
    applyMetadataPatch: true,
    noLogin: true,
    forceLogin: true,
    noTofuApply: true,
  });

  assert.doesNotMatch(command, /--dry-run/);
  assert.doesNotMatch(command, /--without-deployments/);
  assert.doesNotMatch(command, /--apply-metadata-patch/);
  assert.doesNotMatch(command, /--no-login/);
  assert.doesNotMatch(command, /--force-login/);
  assert.doesNotMatch(command, /--no-tofu-apply/);
  assert.doesNotMatch(command, /--local-credential-file/);
});
