#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes.ts";
import { extractNixosSharedHostDeployments } from "../../deployments/contract.ts";
import { runInTemp } from "../lib/test-helpers.ts";

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
  await runInTemp("deployment-cquery-extraction", async (tmp, _$) => {
    const appTargetsPath = path.join(tmp, "projects", "apps", "demoapp", "TARGETS");
    const deployTargetsPath = path.join(tmp, "projects", "deployments", "demoapp-dev", "TARGETS");
    await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
    await fsp.writeFile(
      appTargetsPath,
      [
        'load("@prelude//:rules.bzl", "genrule")',
        "",
        "genrule(",
        '    name = "app",',
        '    out = "app.txt",',
        '    cmd = "printf demo > $OUT",',
        '    labels = ["kind:app", "webapp:static"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      deployTargetsPath,
      [
        'load("//projects/deployments:defs.bzl", "nixos_shared_host_static_webapp_deployment")',
        "",
        "nixos_shared_host_static_webapp_deployment(",
        '    name = "deploy",',
        '    component = "//projects/apps/demoapp:app",',
        '    app_name = "demoapp",',
        "    container_port = 3000,",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query = "set(//projects/deployments/demoapp-dev:deploy //projects/apps/demoapp:app)";
    const cquery = await _$({
      cwd: tmp,
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
    assert.equal(deployments[0]?.label, "//projects/deployments/demoapp-dev:deploy");
    assert.equal(deployments[0]?.name, "deploy");
    assert.equal(deployments[0]?.runtime.appName, "demoapp");
    assert.equal(deployments[0]?.runtime.containerPort, 3000);
    assert.equal(deployments[0]?.providerTarget.hostname, "demoapp.apps.kilty.io");
    assert.equal(
      deployments[0]?.providerTarget.sharedDevTargetIdentity,
      "nixos-shared-host:default:demoapp",
    );
  });
});
