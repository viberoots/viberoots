#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const REPO_ROOT = process.cwd();

test("Pleomino wrapper rejects legacy explicit Cloudflare provider values", async () => {
  await runInTemp("pleomino-context-explicit-provider-drift", async (tmp, $) => {
    await writePleominoFixture(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("pleomino-context-explicit-provider")} cquery --target-platforms prelude//platforms:default //projects/deployments/pleomino/staging:deploy`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stdout) + String(result.stderr),
      /pleomino_cloudflare_deployment must not set account; provider_target\.account comes from deployment context pleomino-staging/,
    );
  });
});

async function writePleominoFixture(tmp: string) {
  await writeFile(
    tmp,
    "projects/apps/pleomino/TARGETS",
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'genrule(name = "app", out = "app.txt", cmd = "printf app > $OUT", labels = ["kind:app", "webapp:static"], visibility = ["PUBLIC"])',
    ].join("\n"),
  );
  await writeFile(
    tmp,
    "projects/deployments/TARGETS",
    [
      'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_defaults")',
      'deployment_defaults(name = "defaults", default_client_profile = "mini", visibility = ["PUBLIC"])',
    ].join("\n"),
  );
  await copyRepoFile(tmp, "projects/deployments/pleomino/shared/family.bzl");
  await copyRepoFile(tmp, "projects/deployments/pleomino/shared/TARGETS");
  await writeFile(
    tmp,
    "projects/deployments/pleomino/staging/TARGETS",
    [
      'load("//projects/deployments/pleomino/shared:family.bzl", "pleomino_cloudflare_deployment")',
      "pleomino_cloudflare_deployment(",
      '    name = "deploy",',
      '    stage = "staging",',
      '    account = "wrong-account",',
      '    project = "wrong-project",',
      '    domain = "staging.pleomino.com",',
      '    admission_policy = "staging_release",',
      '    protection_class = "shared_nonprod",',
      '    prerequisite = "pleomino-dev",',
      ")",
    ].join("\n"),
  );
}

async function copyRepoFile(tmp: string, relativePath: string) {
  const source = path.join(REPO_ROOT, relativePath);
  const target = path.join(tmp, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(source, target);
}

async function writeFile(tmp: string, relativePath: string, contents: string) {
  const target = path.join(tmp, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${contents}\n`, "utf8");
}
