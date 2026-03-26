#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes.ts";
import { extractNixosSharedHostDeployments } from "../../deployments/contract.ts";

const ATTRS = [
  "name",
  "rule_type",
  "provider",
  "component",
  "component_kind",
  "publisher",
  "provisioner",
  "protection_class",
  "app_name",
  "container_port",
  "health_path",
  "target_group",
  "labels",
];

test("nixos-shared-host deployment extraction reads canonical metadata from TARGETS via cquery", async () => {
  const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const query = "set(//projects/deployments/pleomino-dev:deploy //projects/apps/pleomino:app)";
  const cquery = await $({
    cwd: process.cwd(),
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
    },
  })`buck2 --isolation-dir deployment-cquery cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
  const merged = JSON.parse(String(cquery.stdout || "")) as Record<string, any>;
  const { deployments, errors } = extractNixosSharedHostDeployments(nodesFromCqueryJson(merged));
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.label, "//projects/deployments/pleomino-dev:deploy");
  assert.equal(deployments[0]?.name, "deploy");
  assert.equal(deployments[0]?.runtime.appName, "pleomino");
  assert.equal(deployments[0]?.runtime.containerPort, 3000);
  assert.equal(deployments[0]?.providerTarget.hostname, "pleomino.apps.kilty.io");
  assert.equal(
    deployments[0]?.providerTarget.sharedDevTargetIdentity,
    "nixos-shared-host:default:pleomino",
  );
});
