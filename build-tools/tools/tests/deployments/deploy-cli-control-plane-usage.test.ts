#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEPLOY_CLI_USAGE } from "../../deployments/deploy-cli-usage";

test("deploy help documents context-selected control-plane override rules", () => {
  assert.match(DEPLOY_CLI_USAGE, /controlPlanes profile by default/);
  assert.match(DEPLOY_CLI_USAGE, /controlPlaneTokenRef must\s+be a secret:\/\/ or runtime:\/\//s);
  assert.match(DEPLOY_CLI_USAGE, /--control-plane-url <url>.*without deployment context/s);
  assert.match(DEPLOY_CLI_USAGE, /VBR_DEPLOY_CONTROL_PLANE_URL.*without deployment context/s);
  assert.match(DEPLOY_CLI_USAGE, /--remote <name> requires a matching controlPlanes\.<name>/);
  assert.match(DEPLOY_CLI_USAGE, /--allow-control-plane-override.*explicit --control-plane-url/s);
  assert.match(DEPLOY_CLI_USAGE, /VBR_DEPLOY_CONTROL_PLANE_URL never overrides/s);
});
