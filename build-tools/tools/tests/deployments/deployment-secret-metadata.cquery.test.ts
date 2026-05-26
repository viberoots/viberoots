#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_CQUERY_ATTRS } from "../../deployments/deployment-query-attrs";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
import { CUTOVER_APP, CUTOVER_FAMILY } from "./infisical-cutover.fixture";

test("deployment TARGETS emit Infisical secret backend metadata", async () => {
  await runInTemp("deployment-secret-metadata-cquery", async (tmp, _$) => {
    const appTargetsPath = path.join(tmp, "projects", "apps", CUTOVER_FAMILY, "TARGETS");
    const deployTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      CUTOVER_FAMILY,
      "staging",
      "TARGETS",
    );
    await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
    await fsp.writeFile(
      appTargetsPath,
      [
        'load("@prelude//:rules.bzl", "genrule")',
        'genrule(name = "app", out = "app.txt", cmd = "printf app > $OUT", visibility = ["PUBLIC"])',
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      deployTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
        "cloudflare_pages_static_webapp_deployment(",
        '    name = "deploy",',
        `    component = "${CUTOVER_APP}",`,
        '    account = "web-platform-staging",',
        `    project = "${CUTOVER_FAMILY}-staging-pages",`,
        '    protection_class = "local_only",',
        '    secret_backend = "infisical/default",',
        "    infisical_runtime = {",
        '        "site_url": "https://app.infisical.com",',
        '        "project_id": "proj_123",',
        '        "environment": "staging",',
        '        "preferred_credential_source": "infisical_machine_identity_universal_auth",',
        "    },",
        `    infisical_secret_mappings = {"secret://deployments/${CUTOVER_FAMILY}/token": {`,
        `        "secret_path": "/deployments/${CUTOVER_FAMILY}",`,
        '        "secret_name": "CLOUDFLARE_API_TOKEN",',
        "    }},",
        ")",
      ].join("\n"),
      "utf8",
    );
    const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const cquery = await _$({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-secret-metadata-cquery")} cquery --target-platforms prelude//platforms:default //projects/deployments/${CUTOVER_FAMILY}/staging:deploy --json ${attrFlags}`.quiet();
    const node = Object.values(JSON.parse(String(cquery.stdout || "{}")))[0] as any;
    assert.equal(node.secret_backend, "infisical/default");
    assert.equal(node.infisical_runtime.project_id, "proj_123");
    assert.equal(
      node.infisical_secret_mappings[`secret://deployments/${CUTOVER_FAMILY}/token`].secret_name,
      "CLOUDFLARE_API_TOKEN",
    );
  });
});
