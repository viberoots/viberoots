#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes.ts";
import { extractCloudflarePagesDeployments } from "../../deployments/contract.ts";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers.ts";

const ATTRS = [
  "name",
  "rule_type",
  "buck.type",
  "provider",
  "component",
  "component_kind",
  "publisher",
  "publisher_config",
  "protection_class",
  "lane_policy",
  "environment_stage",
  "admission_policy",
  "provider_target",
  "stages",
  "stage_branches",
  "allowed_promotion_edges",
  "artifact_reuse_mode",
  "allowed_refs",
  "required_checks",
  "required_approvals",
  "retry_branch_policy",
  "artifact_attestation_mode",
  "labels",
];

test("cloudflare-pages deployment extraction reads canonical metadata from TARGETS via cquery", async () => {
  await runInTemp("cloudflare-pages-cquery-extraction", async (tmp, _$) => {
    const appTargetsPath = path.join(tmp, "projects", "apps", "pleomino", "TARGETS");
    const deployTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino-staging",
      "TARGETS",
    );
    const laneTargetsPath = path.join(tmp, "build-tools", "deployments", "lanes", "TARGETS");
    const policyTargetsPath = path.join(tmp, "build-tools", "deployments", "policies", "TARGETS");
    await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(laneTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(policyTargetsPath), { recursive: true });
    await fsp.writeFile(
      appTargetsPath,
      [
        'load("@prelude//:rules.bzl", "genrule")',
        "",
        "genrule(",
        '    name = "app",',
        '    out = "app.txt",',
        '    cmd = "printf pleomino > $OUT",',
        '    labels = ["kind:app", "webapp:static"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      laneTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "deployment_lane_policy")',
        "",
        "deployment_lane_policy(",
        '    name = "pleomino",',
        '    stages = ["dev", "staging", "prod"],',
        '    stage_branches = {"dev": "env/pleomino/dev", "staging": "env/pleomino/staging", "prod": "env/pleomino/prod"},',
        '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      policyTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy")',
        "",
        "deployment_admission_policy(",
        '    name = "pleomino_staging_release",',
        '    allowed_refs = ["env/pleomino/staging"],',
        '    required_checks = ["deploy/pleomino-staging"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      deployTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
        "",
        "cloudflare_pages_static_webapp_deployment(",
        '    name = "deploy",',
        '    component = "//projects/apps/pleomino:app",',
        '    account = "web-platform-staging",',
        '    project = "pleomino-staging-pages",',
        '    lane_policy = "//build-tools/deployments/lanes:pleomino",',
        '    environment_stage = "staging",',
        '    admission_policy = "//build-tools/deployments/policies:pleomino_staging_release",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query =
      "set(//projects/deployments/pleomino-staging:deploy //projects/apps/pleomino:app //build-tools/deployments/lanes:pleomino //build-tools/deployments/policies:pleomino_staging_release)";
    const cquery = await _$({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cloudflare-pages-cquery")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
    const merged = JSON.parse(String(cquery.stdout || "")) as Record<string, any>;
    const { deployments, errors } = extractCloudflarePagesDeployments(nodesFromCqueryJson(merged));
    assert.deepEqual(errors, []);
    assert.equal(deployments.length, 1);
    assert.equal(deployments[0]?.label, "//projects/deployments/pleomino-staging:deploy");
    assert.equal(deployments[0]?.publisher.config, "wrangler.jsonc");
    assert.equal(deployments[0]?.providerTarget.account, "web-platform-staging");
    assert.equal(deployments[0]?.providerTarget.project, "pleomino-staging-pages");
  });
});
